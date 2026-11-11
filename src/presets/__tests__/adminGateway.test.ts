import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdminGateway, DEFAULT_ADMIN_EMAIL } from '../adminGateway';

function identityFetch(email: string | null): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => (email ? { authenticated: true, email } : { authenticated: false }),
  } as unknown as Response) as unknown as typeof fetch;
}

describe('AdminGateway (Cloudflare Access UI hint)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Initial state', () => {
    it('starts as non-admin with no token in its state', () => {
      const gateway = new AdminGateway();
      expect(gateway.isAdmin()).toBe(false);
      expect(gateway.getState()).toEqual({ isAdmin: false });
    });

    it('does not read a stored session: a leftover mv.adminSessionToken grants nothing and is removed', () => {
      const store = new Map<string, string>([
        ['mv.adminSessionToken', JSON.stringify({ adminToken: 'old-secret', adminEmail: 'a@b.co' })],
      ]);
      vi.stubGlobal('window', {
        sessionStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        },
      });
      const gateway = new AdminGateway();
      expect(gateway.isAdmin()).toBe(false);
      expect(store.has('mv.adminSessionToken')).toBe(false);
    });

    it('survives a sessionStorage that throws', () => {
      vi.stubGlobal('window', {
        get sessionStorage(): Storage {
          throw new Error('blocked');
        },
      });
      expect(() => new AdminGateway()).not.toThrow();
    });

    it('has no passkey login, header builder or token in its API', () => {
      const gateway = new AdminGateway({ mock: true, defaultAdmin: true }) as unknown as Record<string, unknown>;
      expect(gateway['login']).toBeUndefined();
      expect(gateway['getHeaders']).toBeUndefined();
      expect(gateway['adminToken']).toBeUndefined();
      expect((gateway['getState'] as () => object).call(gateway)).not.toHaveProperty('adminToken');
    });
  });

  describe('Mock mode (admin UI for tests that do not use the network)', () => {
    it('is admin when mock and defaultAdmin are set', () => {
      const gateway = new AdminGateway({ mock: true, defaultAdmin: true, adminEmail: 'lead@music-visualizer.com' });
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState()).toEqual({ isAdmin: true, adminEmail: 'lead@music-visualizer.com', role: 'admin' });
    });

    it('is non-admin when mock is set without defaultAdmin, and the identity check makes no request', async () => {
      const fetchFn = vi.fn();
      const gateway = new AdminGateway({ mock: true, defaultAdmin: false, fetchFn: fetchFn as unknown as typeof fetch });
      expect(gateway.isAdmin()).toBe(false);
      await expect(gateway.checkCloudflareAccess()).resolves.toBe(false);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  describe('Cloudflare Access identity check', () => {
    it('verifies Cloudflare Access identity via /admin/api/identity with credentials, manual redirect, and no-store cache', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          authenticated: true,
          email: 'verified-owner@music-visualizer.com',
        }),
      } as unknown as Response);

      const gateway = new AdminGateway({
        adminEmail: 'verified-owner@music-visualizer.com',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      expect(gateway.isAdmin()).toBe(false);
      const isVerified = await gateway.checkCloudflareAccess();
      expect(isVerified).toBe(true);
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState().adminEmail).toBe('verified-owner@music-visualizer.com');
      expect(mockFetch).toHaveBeenCalledWith('/admin/api/identity', {
        credentials: 'include',
        redirect: 'manual',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });
    });

    it('defaults allowed adminEmail to charliechonguyen@gmail.com when no adminEmail option is passed', async () => {
      expect(DEFAULT_ADMIN_EMAIL).toBe('charliechonguyen@gmail.com');
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated: true, email: 'charliechonguyen@gmail.com' }),
      } as unknown as Response);

      const gateway = new AdminGateway({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const isVerified = await gateway.checkCloudflareAccess();
      expect(isVerified).toBe(true);
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState().adminEmail).toBe('charliechonguyen@gmail.com');
    });

    it('calls the default fetch without a gateway receiver so Cloudflare identity check does not throw Illegal invocation', async () => {
      const originalFetch = globalThis.fetch;
      const stubFetch = function (this: unknown) {
        if (this !== undefined && this !== globalThis) {
          throw new TypeError('Illegal invocation');
        }
        return Promise.resolve(
          new Response(JSON.stringify({ authenticated: true, email: 'charliechonguyen@gmail.com' }), {
            status: 200,
          }),
        );
      };
      try {
        globalThis.fetch = stubFetch as unknown as typeof fetch;
        const gateway = new AdminGateway({ mock: false });
        await expect(gateway.checkCloudflareAccess()).resolves.toBe(true);
        expect(gateway.isAdmin()).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('rejects non-matching emails even when adminEmail option is omitted', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated: true, email: 'intruder@example.com' }),
      } as unknown as Response);

      const gateway = new AdminGateway({
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const isVerified = await gateway.checkCloudflareAccess();
      expect(isVerified).toBe(false);
      expect(gateway.isAdmin()).toBe(false);
    });

    it('rejects Cloudflare Access identity if email does not match adminEmail', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ email: 'other-user@external.com' }),
      } as unknown as Response);

      const gateway = new AdminGateway({
        adminEmail: 'verified-owner@music-visualizer.com',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const isVerified = await gateway.checkCloudflareAccess();
      expect(isVerified).toBe(false);
      expect(gateway.isAdmin()).toBe(false);
    });

    it('returns false when /admin/api/identity returns 401/403 or opaqueredirect', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 0,
        type: 'opaqueredirect',
      } as unknown as Response);

      const gateway = new AdminGateway({
        adminEmail: 'verified-owner@music-visualizer.com',
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const isVerified = await gateway.checkCloudflareAccess();
      expect(isVerified).toBe(false);
      expect(gateway.isAdmin()).toBe(false);
    });
  });

  describe('Logout and listeners', () => {
    it('logout clears admin state and notifies listeners', async () => {
      const gateway = new AdminGateway({ adminEmail: 'lead@music-visualizer.com', fetchFn: identityFetch('LEAD@music-visualizer.com') });
      const listener = vi.fn();
      const unsubscribe = gateway.subscribe(listener);

      await expect(gateway.checkCloudflareAccess()).resolves.toBe(true);
      expect(listener).toHaveBeenLastCalledWith({ isAdmin: true, adminEmail: 'LEAD@music-visualizer.com', role: 'admin' });

      gateway.logout();
      expect(gateway.isAdmin()).toBe(false);
      expect(listener).toHaveBeenLastCalledWith({ isAdmin: false });
      expect(listener).toHaveBeenCalledTimes(2);

      unsubscribe();
      gateway.logout();
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('isolates errors in listener callbacks so other listeners proceed', async () => {
      const gateway = new AdminGateway({ adminEmail: 'lead@music-visualizer.com', fetchFn: identityFetch('lead@music-visualizer.com') });
      const healthy = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      gateway.subscribe(() => {
        throw new Error('Boom');
      });
      gateway.subscribe(healthy);
      await gateway.checkCloudflareAccess();
      expect(healthy).toHaveBeenCalledTimes(1);
    });

    it('stays non-admin when the identity request fails', async () => {
      const gateway = new AdminGateway({ fetchFn: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch });
      await expect(gateway.checkCloudflareAccess()).resolves.toBe(false);
    });
  });
});
