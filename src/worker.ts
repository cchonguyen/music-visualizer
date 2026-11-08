/**
 * Cloudflare Worker Edge Entrypoint (`src/worker.ts`).
 * Sector 487 (Stage 11.6 — Cloudflare Access Identity Verification).
 *
 * Public traffic is served 100% static-first by Cloudflare Assets (`run_worker_first: ["/admin/api/*"]`).
 * Only `/admin/api/*` requests invoke this Worker at the edge.
 */

export interface Env {
  ASSETS: {
    fetch: (request: Request | string) => Promise<Response>;
  };
  ADMIN_EMAIL?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

export const DEFAULT_ADMIN_EMAIL = 'charliechonguyen@gmail.com';
export const DEFAULT_CF_ACCESS_TEAM_DOMAIN = 'https://winter-wind-069c.cloudflareaccess.com';
export const DEFAULT_CF_ACCESS_AUD =
  '516db2b4f5b279ae34450adb290e7413ab7ed73ac85b63219959081d498cd4ab';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store',
};

interface CfAccessJwtPayload {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  email?: string;
  [key: string]: unknown;
}

/**
 * Decode a base64url-encoded JWT payload segment into a JSON object.
 */
function decodeJwtPayload(token: string): CfAccessJwtPayload | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return null;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const decoded = atob(padded);
    const parsed: unknown = JSON.parse(decoded);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CfAccessJwtPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validate Cloudflare Access JWT claims against team domain, application AUD, expiry, and header email.
 */
function verifyCfAccessJwt(
  token: string,
  headerEmail: string,
  expectedTeamDomain: string,
  expectedAud: string,
): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return false;
  }

  // 1. Issuer check (when present in payload)
  if (payload.iss !== undefined) {
    if (typeof payload.iss !== 'string') return false;
    const normalizedIss = payload.iss.trim().replace(/\/+$/, '').toLowerCase();
    const normalizedExpectedIss = expectedTeamDomain.trim().replace(/\/+$/, '').toLowerCase();
    if (normalizedIss !== normalizedExpectedIss) {
      return false;
    }
  }

  // 2. Audience check (when present in payload)
  if (payload.aud !== undefined) {
    if (Array.isArray(payload.aud)) {
      if (!payload.aud.includes(expectedAud)) {
        return false;
      }
    } else if (typeof payload.aud === 'string') {
      if (payload.aud !== expectedAud) {
        return false;
      }
    } else {
      return false;
    }
  }

  // 3. Expiration check
  if (payload.exp !== undefined) {
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
      return false;
    }
  }

  // 4. Email consistency check (when present in payload)
  if (payload.email !== undefined) {
    if (
      typeof payload.email !== 'string' ||
      payload.email.trim().toLowerCase() !== headerEmail.trim().toLowerCase()
    ) {
      return false;
    }
  }

  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/admin/api/identity') {
      const emailHeader = request.headers.get('cf-access-authenticated-user-email')?.trim() ?? '';
      const jwtAssertion = request.headers.get('cf-access-jwt-assertion')?.trim() ?? '';

      if (!emailHeader || !jwtAssertion) {
        return Response.json(
          { authenticated: false, error: 'Unauthenticated' },
          { status: 401, headers: NO_STORE_HEADERS },
        );
      }

      const expectedTeamDomain = env?.CF_ACCESS_TEAM_DOMAIN?.trim() || DEFAULT_CF_ACCESS_TEAM_DOMAIN;
      const expectedAud = env?.CF_ACCESS_AUD?.trim() || DEFAULT_CF_ACCESS_AUD;

      if (!verifyCfAccessJwt(jwtAssertion, emailHeader, expectedTeamDomain, expectedAud)) {
        return Response.json(
          { authenticated: false, error: 'Unauthenticated' },
          { status: 401, headers: NO_STORE_HEADERS },
        );
      }

      const allowedAdminEmail = (env?.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
      if (emailHeader.toLowerCase() !== allowedAdminEmail) {
        return Response.json(
          { authenticated: false, error: 'Forbidden' },
          { status: 403, headers: NO_STORE_HEADERS },
        );
      }

      return Response.json(
        { authenticated: true, email: emailHeader },
        { status: 200, headers: NO_STORE_HEADERS },
      );
    }

    return env.ASSETS.fetch(request);
  },
};
