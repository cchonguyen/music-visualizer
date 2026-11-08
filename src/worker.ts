/**
 * Cloudflare Worker Edge Entrypoint (`src/worker.ts`).
 * Sector 487 (Stage 11.8 — Worker verified identity, /admin handshake and preset write proxy).
 *
 * Public traffic is served 100% static-first by Cloudflare Assets (`run_worker_first: ["/admin", "/admin/*"]`).
 * Only `/admin` and `/admin/*` requests invoke this Worker at the edge.
 */

export interface Env {
  ASSETS: {
    fetch: (request: Request | string) => Promise<Response>;
  };
  ADMIN_EMAIL?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const DEFAULT_ADMIN_EMAIL = 'charliechonguyen@gmail.com';
export const DEFAULT_CF_ACCESS_TEAM_DOMAIN = 'https://winter-wind-069c.cloudflareaccess.com';
export const DEFAULT_CF_ACCESS_AUD =
  '516db2b4f5b279ae34450adb290e7413ab7ed73ac85b63219959081d498cd4ab';

const CF_ACCESS_HEADER = 'cf-access-jwt-assertion';
const CF_ACCESS_EMAIL_HEADER = 'cf-access-authenticated-user-email';
const CF_ACCESS_COOKIE = 'CF_Authorization';
const SIGNAL_CHANNEL = 'mv-admin-auth';
const SIGNAL_STORAGE_KEY = 'mv.adminAuthSignal';
const SIGNAL_TYPE = 'mv-admin-authenticated';
const JWKS_TTL_MS = 10 * 60 * 1000;
const SUPABASE_TABLE_PATH = '/rest/v1/system_presets';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

export type CfAccessReason =
  | 'missing_jwt'
  | 'malformed_jwt'
  | 'bad_alg'
  | 'jwks_unavailable'
  | 'unknown_kid'
  | 'bad_signature'
  | 'iss_mismatch'
  | 'aud_mismatch'
  | 'jwt_expired'
  | 'jwt_not_yet_valid'
  | 'missing_email'
  | 'email_mismatch'
  | 'email_not_allowed';

export interface VerifyCfAccessJwtOptions {
  teamDomain: string;
  aud: string;
  fetchFn?: FetchLike;
  nowMs?: number;
}

export interface VerifyCfAccessJwtResult {
  valid: boolean;
  reason?: CfAccessReason;
  email?: string;
}

interface JwksCacheEntry {
  keys: Map<string, JwkWithKid>;
  fetchedAt: number;
}

type JwkWithKid = JsonWebKey & { kid: string };

const jwksCache = new Map<string, JwksCacheEntry>();

/** Test hook: clears the module-level JWKS cache. */
export function __resetJwksCacheForTests(): void {
  jwksCache.clear();
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS },
  });
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS },
  });
}

function base64UrlToBytes(segment: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  const bytes = base64UrlToBytes(segment);
  if (!bytes) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Fetch the team JWKS and index keys by `kid`. Returns null when the fetch or parse fails.
 */
async function fetchJwks(
  teamBase: string,
  fetchFn: FetchLike,
): Promise<Map<string, JwkWithKid> | null> {
  try {
    const res = await fetchFn(`${teamBase}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!body || typeof body !== 'object') return null;
    const keys = (body as { keys?: unknown }).keys;
    if (!Array.isArray(keys)) return null;
    const map = new Map<string, JwkWithKid>();
    for (const key of keys) {
      if (key && typeof key === 'object' && typeof (key as JwkWithKid).kid === 'string') {
        map.set((key as JwkWithKid).kid, key as JwkWithKid);
      }
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Resolve the JWK for a `kid`. Uses the 10-minute cache; refetches once when the kid is unknown.
 */
async function resolveJwk(
  teamBase: string,
  kid: string,
  fetchFn: FetchLike,
  nowMs: number,
): Promise<{ jwk?: JwkWithKid; reason?: CfAccessReason }> {
  const cached = jwksCache.get(teamBase);
  if (cached && nowMs - cached.fetchedAt < JWKS_TTL_MS) {
    const hit = cached.keys.get(kid);
    if (hit) return { jwk: hit };
  }

  const keys = await fetchJwks(teamBase, fetchFn);
  if (!keys) return { reason: 'jwks_unavailable' };
  jwksCache.set(teamBase, { keys, fetchedAt: nowMs });

  const jwk = keys.get(kid);
  if (!jwk) return { reason: 'unknown_kid' };
  return { jwk };
}

/**
 * Verify a Cloudflare Access JWT: RS256 signature against the team JWKS, then claims.
 * Email is taken only from the signed payload.
 */
export async function verifyCfAccessJwt(
  token: string,
  options: VerifyCfAccessJwtOptions,
): Promise<VerifyCfAccessJwtResult> {
  const fetchFn: FetchLike = options.fetchFn ?? ((input, init) => fetch(input, init));
  const nowMs = options.nowMs ?? Date.now();
  const teamBase = options.teamDomain.trim().replace(/\/+$/, '');

  const trimmed = token.trim();
  if (!trimmed) return { valid: false, reason: 'missing_jwt' };

  const parts = trimmed.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'malformed_jwt' };
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  const header = decodeJsonSegment(headerSegment);
  if (!header) return { valid: false, reason: 'malformed_jwt' };
  if (header.alg !== 'RS256') return { valid: false, reason: 'bad_alg' };
  if (typeof header.kid !== 'string' || !header.kid) {
    return { valid: false, reason: 'unknown_kid' };
  }

  const payload = decodeJsonSegment(payloadSegment);
  if (!payload) return { valid: false, reason: 'malformed_jwt' };

  const signature = base64UrlToBytes(signatureSegment);
  if (!signature) return { valid: false, reason: 'malformed_jwt' };

  const resolved = await resolveJwk(teamBase, header.kid, fetchFn, nowMs);
  if (!resolved.jwk) {
    return { valid: false, reason: resolved.reason ?? 'unknown_kid' };
  }

  let verified = false;
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      resolved.jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signature,
      new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
    );
  } catch {
    verified = false;
  }
  if (!verified) return { valid: false, reason: 'bad_signature' };

  // Claims are checked only after the signature is proven.
  if (typeof payload.iss !== 'string' || normalizeIssuer(payload.iss) !== normalizeIssuer(teamBase)) {
    return { valid: false, reason: 'iss_mismatch' };
  }

  const aud = payload.aud;
  const audOk = Array.isArray(aud)
    ? aud.some((value) => value === options.aud)
    : aud === options.aud;
  if (!audOk) return { valid: false, reason: 'aud_mismatch' };

  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return { valid: false, reason: 'jwt_expired' };
  }
  if (payload.exp * 1000 <= nowMs) return { valid: false, reason: 'jwt_expired' };

  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) {
      return { valid: false, reason: 'jwt_not_yet_valid' };
    }
    if (payload.nbf * 1000 > nowMs) return { valid: false, reason: 'jwt_not_yet_valid' };
  }

  if (typeof payload.email !== 'string' || !payload.email.trim()) {
    return { valid: false, reason: 'missing_email' };
  }

  return { valid: true, email: payload.email.trim() };
}

/**
 * Read a `CF_Authorization` cookie value from a Cookie header.
 */
export function getCfAuthCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === CF_ACCESS_COOKIE) {
      const value = part.slice(index + 1).trim();
      return value || null;
    }
  }
  return null;
}

function getAccessToken(request: Request): string | null {
  const header = request.headers.get(CF_ACCESS_HEADER)?.trim();
  if (header) return header;
  return getCfAuthCookie(request.headers.get('Cookie'));
}

type AuthResult =
  | { ok: true; email: string }
  | { ok: false; reason: CfAccessReason; status: 401 | 403 | 503 };

function statusForReason(reason: CfAccessReason): 401 | 403 | 503 {
  if (reason === 'jwks_unavailable') return 503;
  if (reason === 'email_not_allowed') return 403;
  return 401;
}

/**
 * Full admin check: verified JWT, header email consistency, and allowlist.
 */
async function authenticate(request: Request, env: Env, fetchFn: FetchLike): Promise<AuthResult> {
  const fail = (reason: CfAccessReason): AuthResult => ({
    ok: false,
    reason,
    status: statusForReason(reason),
  });

  const token = getAccessToken(request);
  if (!token) return fail('missing_jwt');

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.trim() || DEFAULT_CF_ACCESS_TEAM_DOMAIN;
  const aud = env.CF_ACCESS_AUD?.trim() || DEFAULT_CF_ACCESS_AUD;
  const result = await verifyCfAccessJwt(token, { teamDomain, aud, fetchFn });
  if (!result.valid || !result.email) return fail(result.reason ?? 'malformed_jwt');

  const email = result.email;
  const headerEmail = request.headers.get(CF_ACCESS_EMAIL_HEADER)?.trim();
  if (headerEmail && headerEmail.toLowerCase() !== email.toLowerCase()) {
    return fail('email_mismatch');
  }

  const allowedEmail = (env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  if (email.toLowerCase() !== allowedEmail) return fail('email_not_allowed');

  return { ok: true, email };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON for embedding in a script element: `<` is escaped so `</script>` cannot close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function renderHandshakePage(auth: AuthResult, isPopup: boolean): Response {
  if (!auth.ok) {
    const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Admin sign-in</title></head>
<body>
<h1>Admin sign-in not verified</h1>
<p>Reason: ${escapeHtml(auth.reason)}</p>
<p><a href="/">Back to the visualizer</a></p>
</body>
</html>`;
    return htmlResponse(page, auth.status);
  }

  const signal = { type: SIGNAL_TYPE, verified: true, ts: Date.now() };
  const page = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Admin sign-in</title></head>
<body>
<h1>Admin signed in</h1>
<p>Signed in as ${escapeHtml(auth.email)}.</p>
<p><a href="/">Back to the visualizer</a></p>
<script>
(function () {
  var signal = ${scriptJson(signal)};
  try { new BroadcastChannel(${scriptJson(SIGNAL_CHANNEL)}).postMessage(signal); } catch (e) {}
  try { localStorage.setItem(${scriptJson(SIGNAL_STORAGE_KEY)}, JSON.stringify(signal)); } catch (e) {}
  try { if (window.opener) { window.opener.postMessage(signal, location.origin); } } catch (e) {}
  window.close();
  var isPopup = ${scriptJson(isPopup)};
  if (!isPopup) { setTimeout(function () { location.replace('/'); }, 400); }
})();
</script>
</body>
</html>`;
  return htmlResponse(page, 200);
}

const PRESET_METHODS = ['POST', 'PATCH'];

async function handlePresetWrite(
  request: Request,
  env: Env,
  fetchFn: FetchLike,
  url: URL,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!PRESET_METHODS.includes(method)) {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'POST, PATCH', ...NO_STORE_HEADERS },
    });
  }

  const auth = await authenticate(request, env, fetchFn);
  if (!auth.ok) {
    return jsonResponse({ error: auth.status === 403 ? 'Forbidden' : 'Unauthenticated', reason: auth.reason }, auth.status);
  }

  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== url.origin) {
    return jsonResponse({ error: 'Forbidden', reason: 'bad_origin' }, 403);
  }

  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.trim().toLowerCase().startsWith('application/json')) {
    return jsonResponse({ error: 'unsupported_media_type' }, 415);
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return jsonResponse({ error: 'invalid_body' }, 400);
  }
  const body = parsed as Record<string, unknown>;

  let presetId: string | null = null;
  if (method === 'POST') {
    if (typeof body.id !== 'string' || !body.id.trim()) {
      return jsonResponse({ error: 'missing_id' }, 400);
    }
    presetId = body.id.trim();
  } else {
    presetId = url.searchParams.get('id')?.trim() || null;
    if (!presetId) return jsonResponse({ error: 'missing_id' }, 400);
  }

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'missing_supabase_config' }, 500);
  }

  const forwarded = { ...body, updated_by: auth.email };
  const target =
    method === 'POST'
      ? `${supabaseUrl}${SUPABASE_TABLE_PATH}`
      : `${supabaseUrl}${SUPABASE_TABLE_PATH}?id=eq.${encodeURIComponent(presetId)}`;
  const headers: Record<string, string> = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: method === 'POST' ? 'resolution=merge-duplicates,return=representation' : 'return=minimal',
  };

  let upstream: Response;
  try {
    upstream = await fetchFn(target, {
      method,
      headers,
      body: JSON.stringify(forwarded),
    });
  } catch {
    return jsonResponse({ error: 'upstream_unreachable' }, 502);
  }

  const noBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  const text = noBody ? null : await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      ...NO_STORE_HEADERS,
    },
  });
}

/**
 * Worker request handler. `fetchFn` is injectable so tests can stub JWKS and Supabase calls.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  fetchFn: FetchLike = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/admin/api/identity') {
    const auth = await authenticate(request, env, fetchFn);
    if (!auth.ok) {
      return jsonResponse(
        {
          authenticated: false,
          error: auth.status === 403 ? 'Forbidden' : 'Unauthenticated',
          reason: auth.reason,
        },
        auth.status,
      );
    }
    return jsonResponse({ authenticated: true, email: auth.email }, 200);
  }

  if (path === '/admin' || path === '/admin/') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return jsonResponse({ error: 'method_not_allowed' }, 405);
    }
    const auth = await authenticate(request, env, fetchFn);
    return renderHandshakePage(auth, url.searchParams.get('popup') === '1');
  }

  if (path === '/admin/api/presets') {
    return handlePresetWrite(request, env, fetchFn, url);
  }

  return env.ASSETS.fetch(request);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
