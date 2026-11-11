import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import worker, {
  MAX_BODY_BYTES,
  __resetJwksCacheForTests,
  getCfAuthCookie,
  handleRequest,
  verifyCfAccessJwt,
  type Env,
  type FetchLike,
} from './worker';

const DEFAULT_ADMIN_EMAIL = 'admin@example.test';
const DEFAULT_CF_ACCESS_TEAM_DOMAIN = 'https://team.cloudflareaccess.test';
const DEFAULT_CF_ACCESS_AUD = 'test-audience-tag';

const KID = 'test-kid-1';
const ADMIN_URL = 'https://music-visualizer.charliechonguyen.com';
const SUPABASE_URL = 'https://project.supabase.test';
const SERVICE_KEY = 'service-role-secret-value';
const CERTS_URL = `${DEFAULT_CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;

let signingPair: CryptoKeyPair;
let forgingPair: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

function bytesToB64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlJson(value: unknown): string {
  return bytesToB64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function signJwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
): Promise<string> {
  const signingInput = `${b64UrlJson(header)}.${b64UrlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${bytesToB64Url(new Uint8Array(signature))}`;
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: DEFAULT_CF_ACCESS_TEAM_DOMAIN,
    aud: [DEFAULT_CF_ACCESS_AUD],
    exp: Math.floor(Date.now() / 1000) + 3600,
    email: DEFAULT_ADMIN_EMAIL,
    ...overrides,
  };
}

function signValid(payload: Record<string, unknown> = validPayload()): Promise<string> {
  return signJwt({ alg: 'RS256', typ: 'JWT', kid: KID }, payload, signingPair.privateKey);
}

/** Stub fetch: serves the JWKS (trusted key only) and records every other call. */
function createFetchStub(options: { jwks?: unknown; status?: number; upstream?: Response } = {}) {
  return vi.fn<FetchLike>(async (input) => {
    const url = String(input);
    if (url === CERTS_URL) {
      if (options.status && options.status !== 200) {
        return new Response('nope', { status: options.status });
      }
      return Response.json(options.jwks ?? { keys: [publicJwk] });
    }
    return options.upstream ?? new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

function upstreamCalls(fetchFn: ReturnType<typeof createFetchStub>) {
  return fetchFn.mock.calls.filter(([input]) => String(input) !== CERTS_URL);
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: {
      fetch: vi.fn(async () => new Response('Static Asset Content', { status: 200 })),
    },
    ADMIN_EMAIL: DEFAULT_ADMIN_EMAIL,
    CF_ACCESS_TEAM_DOMAIN: DEFAULT_CF_ACCESS_TEAM_DOMAIN,
    CF_ACCESS_AUD: DEFAULT_CF_ACCESS_AUD,
    SUPABASE_URL: `${SUPABASE_URL}/`,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    ...overrides,
  };
}

function identityRequest(headers: Record<string, string> = {}): Request {
  return new Request(`${ADMIN_URL}/admin/api/identity`, { headers });
}

function presetRequest(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body: unknown = { id: 'preset-1', name: 'Test' },
): Request {
  return new Request(`${ADMIN_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body),
  });
}

describe('Worker verified identity (src/worker.ts)', () => {
  beforeAll(async () => {
    signingPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    forgingPair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const exported = await crypto.subtle.exportKey('jwk', signingPair.publicKey);
    publicJwk = { ...exported, kid: KID, alg: 'RS256', use: 'sig' };
  });

  beforeEach(() => {
    __resetJwksCacheForTests();
  });

  describe('getCfAuthCookie', () => {
    it('reads CF_Authorization from a Cookie header', () => {
      expect(getCfAuthCookie('a=1; CF_Authorization=abc.def.ghi; b=2')).toBe('abc.def.ghi');
      expect(getCfAuthCookie('CF_Authorization=')).toBeNull();
      expect(getCfAuthCookie('other=1')).toBeNull();
      expect(getCfAuthCookie(null)).toBeNull();
    });
  });

  describe('verifyCfAccessJwt', () => {
    it('accepts a correctly signed token and returns the signed email', async () => {
      const token = await signValid();
      const result = await verifyCfAccessJwt(token, {
        teamDomain: DEFAULT_CF_ACCESS_TEAM_DOMAIN,
        aud: DEFAULT_CF_ACCESS_AUD,
        fetchFn: createFetchStub(),
      });
      expect(result).toEqual({ valid: true, email: DEFAULT_ADMIN_EMAIL });
    });

    it('rejects a token signed by another key with bad_signature', async () => {
      const forged = await signJwt(
        { alg: 'RS256', typ: 'JWT', kid: KID },
        validPayload(),
        forgingPair.privateKey,
      );
      const result = await verifyCfAccessJwt(forged, {
        teamDomain: DEFAULT_CF_ACCESS_TEAM_DOMAIN,
        aud: DEFAULT_CF_ACCESS_AUD,
        fetchFn: createFetchStub(),
      });
      expect(result).toEqual({ valid: false, reason: 'bad_signature' });
    });

    it('rejects alg none and unsigned tokens with bad_alg', async () => {
      const unsigned = `${b64UrlJson({ alg: 'none', kid: KID })}.${b64UrlJson(validPayload())}.`;
      const result = await verifyCfAccessJwt(unsigned, {
        teamDomain: DEFAULT_CF_ACCESS_TEAM_DOMAIN,
        aud: DEFAULT_CF_ACCESS_AUD,
        fetchFn: createFetchStub(),
      });
      expect(result).toEqual({ valid: false, reason: 'bad_alg' });
    });

    it('rejects an RS256 token with an empty signature as malformed', async () => {
      const emptySig = `${b64UrlJson({ alg: 'RS256', kid: KID })}.${b64UrlJson(validPayload())}.`;
      const result = await verifyCfAccessJwt(emptySig, {
        teamDomain: DEFAULT_CF_ACCESS_TEAM_DOMAIN,
        aud: DEFAULT_CF_ACCESS_AUD,
        fetchFn: createFetchStub(),
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('malformed_jwt');
    });

    it('rejects wrong issuer, wrong audience, expired, missing exp, not-yet-valid and missing email', async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [validPayload({ iss: 'https://evil.cloudflareaccess.com' }), 'iss_mismatch'],
        [validPayload({ aud: ['other-aud'] }), 'aud_mismatch'],
        [validPayload({ exp: Math.floor(Date.now() / 1000) - 60 }), 'jwt_expired'],
        [validPayload({ exp: undefined }), 'jwt_expired'],
        [validPayload({ nbf: Math.floor(Date.now() / 1000) + 600 }), 'jwt_not_yet_valid'],
        [validPayload({ email: '' }), 'missing_email'],
      ];
      for (const [payload, reason] of cases) {
        const token = await signValid(payload);
        const result = await verifyCfAccessJwt(token, {
          teamDomain: DEFAULT_CF_ACCESS_TEAM_DOMAIN,
          aud: DEFAULT_CF_ACCESS_AUD,
          fetchFn: createFetchStub(),
        });
        expect(result).toEqual({ valid: false, reason });
      }
    });

    it('returns jwks_unavailable when the JWKS fetch fails', async () => {
      const token = await signValid();
      const result = await verifyCfAccessJwt(token, {
        teamDomain: DEFAULT_CF_ACCESS_TEAM_DOMAIN,
        aud: DEFAULT_CF_ACCESS_AUD,
        fetchFn: createFetchStub({ status: 500 }),
      });
      expect(result).toEqual({ valid: false, reason: 'jwks_unavailable' });
    });

    it('caches JWKS for the TTL and refetches once for an unknown kid', async () => {
      const fetchFn = createFetchStub();
      const token = await signValid();
      const opts = { teamDomain: DEFAULT_CF_ACCESS_TEAM_DOMAIN, aud: DEFAULT_CF_ACCESS_AUD, fetchFn };
      await verifyCfAccessJwt(token, opts);
      await verifyCfAccessJwt(token, opts);
      expect(fetchFn).toHaveBeenCalledTimes(1);

      const unknown = await signJwt(
        { alg: 'RS256', typ: 'JWT', kid: 'rotated-kid' },
        validPayload(),
        signingPair.privateKey,
      );
      const result = await verifyCfAccessJwt(unknown, opts);
      expect(result).toEqual({ valid: false, reason: 'unknown_kid' });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('GET /admin/api/identity', () => {
    it('authenticates with the cf-access-jwt-assertion header', async () => {
      const token = await signValid();
      const res = await handleRequest(
        identityRequest({
          'cf-access-jwt-assertion': token,
          'cf-access-authenticated-user-email': DEFAULT_ADMIN_EMAIL,
        }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toEqual({ authenticated: true, email: DEFAULT_ADMIN_EMAIL });
    });

    it('authenticates with only the CF_Authorization cookie', async () => {
      const token = await signValid();
      const res = await handleRequest(
        identityRequest({ Cookie: `theme=dark; CF_Authorization=${token}` }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ authenticated: true, email: DEFAULT_ADMIN_EMAIL });
    });

    it('returns 401 missing_jwt when no token is present', async () => {
      const res = await handleRequest(
        identityRequest({ 'cf-access-authenticated-user-email': DEFAULT_ADMIN_EMAIL }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toEqual({
        authenticated: false,
        error: 'Unauthenticated',
        reason: 'missing_jwt',
      });
    });

    it('returns 401 bad_signature for a forged token', async () => {
      const forged = await signJwt(
        { alg: 'RS256', typ: 'JWT', kid: KID },
        validPayload(),
        forgingPair.privateKey,
      );
      const res = await handleRequest(
        identityRequest({ 'cf-access-jwt-assertion': forged }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(401);
      expect((await res.json()).reason).toBe('bad_signature');
    });

    it('returns 401 for a wrong issuer, wrong audience and expired token', async () => {
      const cases: Array<[Record<string, unknown>, string]> = [
        [validPayload({ iss: 'https://evil.cloudflareaccess.com' }), 'iss_mismatch'],
        [validPayload({ aud: 'nope' }), 'aud_mismatch'],
        [validPayload({ exp: 1 }), 'jwt_expired'],
      ];
      for (const [payload, reason] of cases) {
        const token = await signValid(payload);
        const res = await handleRequest(
          identityRequest({ 'cf-access-jwt-assertion': token }),
          makeEnv(),
          createFetchStub(),
        );
        expect(res.status).toBe(401);
        expect((await res.json()).reason).toBe(reason);
      }
    });

    it('returns 401 email_mismatch when the header email differs from the signed email', async () => {
      const token = await signValid();
      const res = await handleRequest(
        identityRequest({
          'cf-access-jwt-assertion': token,
          'cf-access-authenticated-user-email': 'someone-else@example.com',
        }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(401);
      expect((await res.json()).reason).toBe('email_mismatch');
    });

    it('returns 403 email_not_allowed for a valid non-admin token', async () => {
      const token = await signValid(validPayload({ email: 'intruder@example.com' }));
      const res = await handleRequest(
        identityRequest({ 'cf-access-jwt-assertion': token }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(403);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await res.json()).toEqual({
        authenticated: false,
        error: 'Forbidden',
        reason: 'email_not_allowed',
      });
    });

    it('returns 503 jwks_unavailable when the JWKS cannot be fetched', async () => {
      const token = await signValid();
      const res = await handleRequest(
        identityRequest({ 'cf-access-jwt-assertion': token }),
        makeEnv(),
        createFetchStub({ status: 503 }),
      );
      expect(res.status).toBe(503);
      expect((await res.json()).reason).toBe('jwks_unavailable');
    });
  });

  describe('GET /admin and /admin/ handshake page', () => {
    it('returns 200 HTML and the verified signal when the admin is signed in', async () => {
      const token = await signValid();
      for (const path of ['/admin', '/admin/']) {
        const res = await handleRequest(
          new Request(`${ADMIN_URL}${path}`, { headers: { Cookie: `CF_Authorization=${token}` } }),
          makeEnv(),
          createFetchStub(),
        );
        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('no-store');
        const html = await res.text();
        expect(html).toContain('mv-admin-authenticated');
        expect(html).toContain('BroadcastChannel');
        expect(html).toContain('mv-admin-auth');
        expect(html).toContain('mv.adminAuthSignal');
        expect(html).toContain('window.opener.postMessage(signal, location.origin)');
        expect(html).toContain('window.close()');
        expect(html).toContain('location.replace');
      }
    });

    it('escapes the email in the body and keeps script JSON from closing the tag', async () => {
      const weirdEmail = `a<b>"'&</script><script>x()</script>@example.com`;
      const token = await signValid(validPayload({ email: weirdEmail }));
      const res = await handleRequest(
        new Request(`${ADMIN_URL}/admin`, { headers: { Cookie: `CF_Authorization=${token}` } }),
        makeEnv({ ADMIN_EMAIL: weirdEmail }),
        createFetchStub(),
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('a&lt;b&gt;&quot;&#39;&amp;&lt;/script&gt;&lt;script&gt;x()&lt;/script&gt;@example.com');
      expect(html).not.toContain('<b>');
      expect(html).not.toContain('x()</script>');
    });

    it('returns the reason and no signal when not verified', async () => {
      const res = await handleRequest(
        new Request(`${ADMIN_URL}/admin`),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(401);
      const html = await res.text();
      expect(html).toContain('missing_jwt');
      expect(html).toContain('href="/"');
      expect(html).not.toContain('mv-admin-authenticated');
    });

    it('returns 403 without a signal for a non-admin token', async () => {
      const token = await signValid(validPayload({ email: 'intruder@example.com' }));
      const res = await handleRequest(
        new Request(`${ADMIN_URL}/admin`, { headers: { Cookie: `CF_Authorization=${token}` } }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain('mv-admin-authenticated');
    });

    it('falls through non-handshake /admin/* paths to ASSETS', async () => {
      const env = makeEnv();
      const req = new Request(`${ADMIN_URL}/admin/assets/app.js`);
      const res = await handleRequest(req, env, createFetchStub());
      expect(await res.text()).toBe('Static Asset Content');
      expect(env.ASSETS.fetch).toHaveBeenCalledWith(req);
    });

    it('default export delegates to the handler', async () => {
      const env = makeEnv();
      const req = new Request(`${ADMIN_URL}/admin/assets/style.css`);
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(env.ASSETS.fetch).toHaveBeenCalledWith(req);
    });
  });

  describe('/admin/api/presets write proxy', () => {
    let token: string;

    beforeEach(async () => {
      token = await signValid();
    });

    const authHeaders = (): Record<string, string> => ({ 'cf-access-jwt-assertion': token });

    it('POST upserts only against env.SUPABASE_URL with the service key and injects updated_by', async () => {
      const fetchFn = createFetchStub();
      const res = await handleRequest(
        presetRequest('POST', '/admin/api/presets', {
          ...authHeaders(),
          'x-supabase-url': 'https://evil.example.test',
        }, { id: 'preset-1', name: 'Test', updated_by: 'spoofed@example.com' }),
        makeEnv(),
        fetchFn,
      );

      expect(res.status).toBe(201);
      const calls = fetchFn.mock.calls.filter(([input]) => String(input) !== CERTS_URL);
      expect(calls).toHaveLength(1);
      const [target, init] = calls[0] as [string, RequestInit];
      expect(target).toBe(`${SUPABASE_URL}/rest/v1/system_presets`);
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers.apikey).toBe(SERVICE_KEY);
      expect(headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
      expect(headers.Prefer).toBe('resolution=merge-duplicates,return=representation');
      const forwarded = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(forwarded.updated_by).toBe(DEFAULT_ADMIN_EMAIL);
      expect(forwarded.id).toBe('preset-1');
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ ok: true });
      expect(text).not.toContain(SERVICE_KEY);
    });

    it('PATCH soft-deletes via ?id=eq.<encoded id> with return=minimal', async () => {
      const fetchFn = createFetchStub();
      const res = await handleRequest(
        presetRequest('PATCH', '/admin/api/presets?id=a%2Fb%20c', authHeaders(), { is_deleted: true }),
        makeEnv(),
        fetchFn,
      );
      expect(res.status).toBe(201);
      const [target, init] = fetchFn.mock.calls[1] as [string, RequestInit];
      expect(target).toBe(`${SUPABASE_URL}/rest/v1/system_presets?id=eq.a%2Fb%20c`);
      expect(init.method).toBe('PATCH');
      expect((init.headers as Record<string, string>).Prefer).toBe('return=minimal');
      expect(JSON.parse(String(init.body)).updated_by).toBe(DEFAULT_ADMIN_EMAIL);
    });

    it('passes the upstream status and body through, including no-body statuses', async () => {
      const conflict = await handleRequest(
        presetRequest('POST', '/admin/api/presets', authHeaders()),
        makeEnv(),
        createFetchStub({
          upstream: new Response('{"message":"conflict"}', {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          }),
        }),
      );
      expect(conflict.status).toBe(409);
      expect(await conflict.text()).toBe('{"message":"conflict"}');

      const minimal = await handleRequest(
        presetRequest('PATCH', '/admin/api/presets?id=preset-1', authHeaders(), {}),
        makeEnv(),
        createFetchStub({ upstream: new Response(null, { status: 204 }) }),
      );
      expect(minimal.status).toBe(204);
    });

    it('rejects unauthenticated writes with 401 and never calls upstream', async () => {
      const fetchFn = createFetchStub();
      const res = await handleRequest(
        presetRequest('POST', '/admin/api/presets'),
        makeEnv(),
        fetchFn,
      );
      expect(res.status).toBe(401);
      expect(upstreamCalls(fetchFn)).toHaveLength(0);
    });

    it('rejects a non-admin token with 403 and never calls upstream', async () => {
      const intruder = await signValid(validPayload({ email: 'intruder@example.com' }));
      const fetchFn = createFetchStub();
      const res = await handleRequest(
        presetRequest('POST', '/admin/api/presets', { 'cf-access-jwt-assertion': intruder }),
        makeEnv(),
        fetchFn,
      );
      expect(res.status).toBe(403);
      expect(upstreamCalls(fetchFn)).toHaveLength(0);
    });

    it('rejects a cross-origin request with 403 bad_origin', async () => {
      const fetchFn = createFetchStub();
      const res = await handleRequest(
        presetRequest('POST', '/admin/api/presets', { ...authHeaders(), Origin: 'https://evil.example.test' }),
        makeEnv(),
        fetchFn,
      );
      expect(res.status).toBe(403);
      expect((await res.json()).reason).toBe('bad_origin');
      expect(upstreamCalls(fetchFn)).toHaveLength(0);
    });

    it('accepts a same-origin Origin header', async () => {
      const res = await handleRequest(
        presetRequest('POST', '/admin/api/presets', { ...authHeaders(), Origin: ADMIN_URL }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(201);
    });

    it('rejects a non-JSON content type with 415', async () => {
      const req = new Request(`${ADMIN_URL}/admin/api/presets`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'text/plain' },
        body: JSON.stringify({ id: 'preset-1' }),
      });
      const fetchFn = createFetchStub();
      const res = await handleRequest(req, makeEnv(), fetchFn);
      expect(res.status).toBe(415);
      expect(upstreamCalls(fetchFn)).toHaveLength(0);
    });

    it('rejects invalid JSON and non-object bodies with 400', async () => {
      const badJson = new Request(`${ADMIN_URL}/admin/api/presets`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: '{not json',
      });
      expect((await handleRequest(badJson, makeEnv(), createFetchStub())).status).toBe(400);

      const arrayBody = presetRequest('POST', '/admin/api/presets', authHeaders(), [1, 2]);
      expect((await handleRequest(arrayBody, makeEnv(), createFetchStub())).status).toBe(400);
    });

    it('requires a string id on POST and an id query on PATCH', async () => {
      const noId = presetRequest('POST', '/admin/api/presets', authHeaders(), { name: 'x' });
      expect((await handleRequest(noId, makeEnv(), createFetchStub())).status).toBe(400);

      const noQuery = presetRequest('PATCH', '/admin/api/presets', authHeaders(), {});
      expect((await handleRequest(noQuery, makeEnv(), createFetchStub())).status).toBe(400);
    });

    it('returns 500 missing_supabase_config without calling upstream', async () => {
      const fetchFn = createFetchStub();
      const res = await handleRequest(
        presetRequest('POST', '/admin/api/presets', authHeaders()),
        makeEnv({ SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: undefined }),
        fetchFn,
      );
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('missing_supabase_config');
      expect(upstreamCalls(fetchFn)).toHaveLength(0);
    });

    it('returns 405 for methods other than POST and PATCH', async () => {
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const req = new Request(`${ADMIN_URL}/admin/api/presets?id=preset-1`, {
          method,
          headers: authHeaders(),
        });
        const res = await handleRequest(req, makeEnv(), createFetchStub());
        expect(res.status).toBe(405);
      }
    });

    it('forwards only allowlisted columns and drops everything else', async () => {
      const fetchFn = createFetchStub();
      await handleRequest(
        presetRequest('POST', '/admin/api/presets', authHeaders(), {
          id: 'preset-1',
          name: 'Test',
          subfolder: 'flagship',
          preset_data: { a: 1 },
          sort_order: 3,
          tags: ['x'],
          is_deleted: false,
          role: 'admin',
          created_at: 'x',
          extra: { nested: true },
        }),
        makeEnv(),
        fetchFn,
      );
      const [, init] = upstreamCalls(fetchFn)[0] as [string, RequestInit];
      expect(JSON.parse(String(init.body))).toEqual({
        id: 'preset-1',
        name: 'Test',
        subfolder: 'flagship',
        preset_data: { a: 1 },
        sort_order: 3,
        tags: ['x'],
        is_deleted: false,
        updated_by: DEFAULT_ADMIN_EMAIL,
      });
    });

    it('rejects allowlisted columns of the wrong type with 400', async () => {
      const bad: Record<string, unknown>[] = [
        { id: 'p', name: 5 },
        { id: 'p', subfolder: 'nope' },
        { id: 'p', preset_data: [1] },
        { id: 'p', sort_order: 'high' },
        { id: 'p', tags: [1] },
        { id: 'p', is_deleted: 'yes' },
      ];
      for (const body of bad) {
        const fetchFn = createFetchStub();
        const res = await handleRequest(
          presetRequest('POST', '/admin/api/presets', authHeaders(), body),
          makeEnv(),
          fetchFn,
        );
        expect(res.status).toBe(400);
        expect((await res.json()).error).toBe('invalid_field');
        expect(upstreamCalls(fetchFn)).toHaveLength(0);
      }
    });

    it('rejects a body over 256 KB with 413, by Content-Length and by streamed size', async () => {
      const big = { id: 'p', name: 'x'.repeat(MAX_BODY_BYTES + 10) };
      const fetchFn = createFetchStub();
      const res = await handleRequest(
        presetRequest('POST', '/admin/api/presets', authHeaders(), big),
        makeEnv(),
        fetchFn,
      );
      expect(res.status).toBe(413);

      const lying = new Request(`${ADMIN_URL}/admin/api/presets`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(big),
      });
      lying.headers.delete('Content-Length');
      expect((await handleRequest(lying, makeEnv(), fetchFn)).status).toBe(413);
      expect(upstreamCalls(fetchFn)).toHaveLength(0);
    });

    it('accepts a body just under the cap', async () => {
      const body = { id: 'p', name: 'x'.repeat(MAX_BODY_BYTES - 100) };
      const res = await handleRequest(
        presetRequest('POST', '/admin/api/presets', authHeaders(), body),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(201);
    });

    it('fails closed with 503 when ADMIN_EMAIL, team domain or audience is missing', async () => {
      for (const missing of ['ADMIN_EMAIL', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD'] as const) {
        const fetchFn = createFetchStub();
        const res = await handleRequest(
          presetRequest('POST', '/admin/api/presets', authHeaders()),
          makeEnv({ [missing]: undefined }),
          fetchFn,
        );
        expect(res.status).toBe(503);
        expect((await res.json()).reason).toBe('admin_config_missing');
        expect(upstreamCalls(fetchFn)).toHaveLength(0);
      }
      const identity = await handleRequest(
        identityRequest({ 'cf-access-jwt-assertion': token }),
        makeEnv({ ADMIN_EMAIL: '  ' }),
        createFetchStub(),
      );
      expect(identity.status).toBe(503);
    });
  });

  describe('security headers', () => {
    it('adds CSP, nosniff, referrer and frame protection to JSON responses', async () => {
      const res = await handleRequest(identityRequest(), makeEnv(), createFetchStub());
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("script-src 'none'");
    });

    it('lets the /admin handshake script run through a matching nonce, with no unsafe-inline', async () => {
      const token = await signValid();
      const res = await handleRequest(
        new Request(`${ADMIN_URL}/admin`, { headers: { 'cf-access-jwt-assertion': token } }),
        makeEnv(),
        createFetchStub(),
      );
      expect(res.status).toBe(200);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce).toBeTruthy();
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).toContain("frame-ancestors 'none'");
      const html = await res.text();
      expect(html).toContain(`<script nonce="${nonce}">`);
      expect(html.match(/<script/g)).toHaveLength(1);
      expect(html).not.toMatch(/<style|style="|onclick=/);
    });

    it('uses a fresh nonce per response', async () => {
      const nonceOf = async (): Promise<string | undefined> => {
        const token = await signValid();
        const res = await handleRequest(
          new Request(`${ADMIN_URL}/admin`, { headers: { 'cf-access-jwt-assertion': token } }),
          makeEnv(),
          createFetchStub(),
        );
        return /nonce-([^']+)'/.exec(res.headers.get('Content-Security-Policy') ?? '')?.[1];
      };
      expect(await nonceOf()).not.toBe(await nonceOf());
    });

    it('leaves static asset pass-through responses untouched', async () => {
      const res = await handleRequest(new Request(`${ADMIN_URL}/admin/other`), makeEnv(), createFetchStub());
      expect(await res.text()).toBe('Static Asset Content');
      expect(res.headers.get('Content-Security-Policy')).toBeNull();
    });
  });
});
