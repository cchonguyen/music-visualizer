import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AdminGateway,
  ADMIN_SESSION_STORAGE_KEY,
  computeSha256,
} from '../adminGateway';
import type { RemoteConfig } from '../../config/remoteConfig';

function createMemoryStorage(initialData: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

describe('AdminGateway & Session Security Verification', () => {
  let memStorage: Storage;

  beforeEach(() => {
    memStorage = createMemoryStorage();
  });

  describe('Session Initialization & Fallbacks', () => {
    it('defaults to non-admin state when storage is empty', () => {
      const gateway = new AdminGateway({ storage: memStorage });
      expect(gateway.isAdmin()).toBe(false);
      expect(gateway.getState()).toEqual({ isAdmin: false });
    });

    it('initializes admin state from valid JSON in sessionStorage', () => {
      memStorage.setItem(
        ADMIN_SESSION_STORAGE_KEY,
        JSON.stringify({
          adminToken: 'secret-token-123',
          adminEmail: 'admin@music-visualizer.com',
          role: 'admin',
        }),
      );

      const gateway = new AdminGateway({ storage: memStorage });
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState()).toEqual({
        isAdmin: true,
        adminToken: 'secret-token-123',
        adminEmail: 'admin@music-visualizer.com',
        role: 'admin',
      });
    });

    it('initializes admin state from raw token string in sessionStorage', () => {
      memStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'raw-service-token');

      const gateway = new AdminGateway({ storage: memStorage });
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState()).toEqual({
        isAdmin: true,
        adminToken: 'raw-service-token',
        role: 'admin',
      });
    });

    it('gracefully handles malformed JSON in storage', () => {
      memStorage.setItem(ADMIN_SESSION_STORAGE_KEY, '{invalid-json');

      const gateway = new AdminGateway({ storage: memStorage });
      // Malformed json fallback parses non-empty string as raw token
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState().adminToken).toBe('{invalid-json');
    });

    it('handles empty or whitespace string in storage as non-admin', () => {
      memStorage.setItem(ADMIN_SESSION_STORAGE_KEY, '   ');

      const gateway = new AdminGateway({ storage: memStorage });
      expect(gateway.isAdmin()).toBe(false);
    });

    it('operates safely when storage is unavailable', () => {
      const gateway = new AdminGateway({ storage: undefined });
      expect(gateway.isAdmin()).toBe(false);
      expect(() => gateway.logout()).not.toThrow();
    });

    it('handles throwing storage methods gracefully', () => {
      const throwingStorage: Storage = {
        getItem: () => {
          throw new Error('Access denied');
        },
        setItem: () => {
          throw new Error('Quota exceeded');
        },
        removeItem: () => {
          throw new Error('Security error');
        },
        clear: () => {},
        key: () => null,
        length: 0,
      };

      const gateway = new AdminGateway({ storage: throwingStorage });
      expect(gateway.isAdmin()).toBe(false);
      expect(() => gateway.logout()).not.toThrow();
    });
  });

  describe('Mock Mode (Deterministic Test Harness)', () => {
    it('initializes as admin when mock and defaultAdmin are true', () => {
      const gateway = new AdminGateway({
        mock: true,
        defaultAdmin: true,
        adminEmail: 'custom-admin@music-visualizer.com',
      });
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState()).toEqual({
        isAdmin: true,
        adminToken: 'mock-admin-token',
        adminEmail: 'custom-admin@music-visualizer.com',
        role: 'admin',
      });
    });

    it('initializes as non-admin when mock is true and defaultAdmin is false', () => {
      const gateway = new AdminGateway({ mock: true, defaultAdmin: false });
      expect(gateway.isAdmin()).toBe(false);
    });

    it('allows successful login in mock mode', async () => {
      const gateway = new AdminGateway({ mock: true, defaultAdmin: false, storage: memStorage });
      const result = await gateway.login({ secret: 'any-valid-secret', email: 'test@admin.com' });
      expect(result.success).toBe(true);
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState().adminToken).toBe('any-valid-secret');
      expect(gateway.getState().adminEmail).toBe('test@admin.com');

      // Verifies storage write
      expect(memStorage.getItem(ADMIN_SESSION_STORAGE_KEY)).toContain('any-valid-secret');
    });

    it('rejects invalid credentials in mock mode', async () => {
      const gateway = new AdminGateway({ mock: true, defaultAdmin: false });
      const res1 = await gateway.login({ secret: 'wrong-passkey' });
      expect(res1.success).toBe(false);
      expect(res1.error).toBe('Invalid admin credentials');
      expect(gateway.isAdmin()).toBe(false);

      const res2 = await gateway.login({ secret: 'invalid' });
      expect(res2.success).toBe(false);

      const res3 = await gateway.login({ email: 'unauthorized@example.com' });
      expect(res3.success).toBe(false);
    });
  });

  describe('Passkey & SHA-256 Verification', () => {
    it('computes correct SHA-256 hash', async () => {
      const hash = await computeSha256('music-visualizer-admin');
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
      // Repeating hash gives identical deterministic result
      const hash2 = await computeSha256('music-visualizer-admin');
      expect(hash).toBe(hash2);
    });

    it('logs in successfully when passkey matches adminPasskeyHash', async () => {
      const rawSecret = 'correct-master-passkey';
      const expectedHash = await computeSha256(rawSecret);

      const config: RemoteConfig = {
        supabaseUrl: 'https://example.supabase.co',
        anonKey: 'anon-key-123',
        adminPasskeyHash: expectedHash,
      };

      const gateway = new AdminGateway({ storage: memStorage, config });
      const result = await gateway.login({ secret: rawSecret });

      expect(result.success).toBe(true);
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState().adminToken).toBe(rawSecret);
      expect(gateway.getState().role).toBe('admin');
    });

    it('rejects passkey when SHA-256 does not match adminPasskeyHash', async () => {
      const expectedHash = await computeSha256('correct-passkey');

      const config: RemoteConfig = {
        supabaseUrl: 'https://example.supabase.co',
        anonKey: 'anon-key-123',
        adminPasskeyHash: expectedHash,
      };

      const gateway = new AdminGateway({ storage: memStorage, config });
      const result = await gateway.login({ secret: 'incorrect-passkey' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid admin passkey');
      expect(gateway.isAdmin()).toBe(false);
    });

    it('verifies token via remote probe when no hash is configured', async () => {
      const config: RemoteConfig = {
        supabaseUrl: 'https://test.supabase.co',
        anonKey: 'anon-123',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);

      const gateway = new AdminGateway({
        storage: memStorage,
        config,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await gateway.login({ secret: 'service-role-secret' });
      expect(result.success).toBe(true);
      expect(gateway.isAdmin()).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.supabase.co/rest/v1/system_presets?select=id&limit=1',
        expect.objectContaining({
          method: 'GET',
          headers: {
            apikey: 'anon-123',
            Authorization: 'Bearer service-role-secret',
          },
        }),
      );
    });

    it('handles remote probe failure with error', async () => {
      const config: RemoteConfig = {
        supabaseUrl: 'https://test.supabase.co',
        anonKey: 'anon-123',
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      } as Response);

      const gateway = new AdminGateway({
        storage: memStorage,
        config,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await gateway.login({ secret: 'bad-secret' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Passkey or token verification failed');
      expect(gateway.isAdmin()).toBe(false);
    });

    it('handles remote network exception gracefully during probe', async () => {
      const config: RemoteConfig = {
        supabaseUrl: 'https://test.supabase.co',
        anonKey: 'anon-123',
      };

      const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));

      const gateway = new AdminGateway({
        storage: memStorage,
        config,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await gateway.login({ secret: 'any-secret' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(gateway.isAdmin()).toBe(false);
    });
  });

  describe('Cloudflare Access Email Verification', () => {
    it('authenticates user when email matches configured adminEmail', async () => {
      const gateway = new AdminGateway({
        storage: memStorage,
        adminEmail: 'lead@music-visualizer.com',
      });

      const result = await gateway.login({ email: 'LEAD@music-visualizer.com' }); // case-insensitive match
      expect(result.success).toBe(true);
      expect(gateway.isAdmin()).toBe(true);
      expect(gateway.getState().adminEmail).toBe('LEAD@music-visualizer.com');
      expect(gateway.getState().adminToken).toBe('cf-access-verified');
    });

    it('rejects email that does not match configured adminEmail', async () => {
      const gateway = new AdminGateway({
        storage: memStorage,
        adminEmail: 'lead@music-visualizer.com',
      });

      const result = await gateway.login({ email: 'intruder@random.com' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized admin email');
      expect(gateway.isAdmin()).toBe(false);
    });

    it('rejects empty credentials or whitespace-only inputs', async () => {
      const gateway = new AdminGateway({ storage: memStorage });
      const res1 = await gateway.login({});
      expect(res1.success).toBe(false);
      expect(res1.error).toBe('No credentials provided');

      const res2 = await gateway.login({ secret: '   ', email: '   ' });
      expect(res2.success).toBe(false);
      expect(res2.error).toBe('No credentials provided');
    });

    it('rejects invalid email formatting when no target email configured', async () => {
      const gateway = new AdminGateway({ storage: memStorage, config: { supabaseUrl: '', anonKey: '' } });
      const res = await gateway.login({ email: 'not-an-email' });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid email format');
    });
  });

  describe('Logout & Session Teardown', () => {
    it('clears state and removes sessionStorage token on logout', async () => {
      const gateway = new AdminGateway({ mock: true, defaultAdmin: true, storage: memStorage });
      expect(gateway.isAdmin()).toBe(true);

      gateway.logout();

      expect(gateway.isAdmin()).toBe(false);
      expect(gateway.getState()).toEqual({ isAdmin: false });
      expect(memStorage.getItem(ADMIN_SESSION_STORAGE_KEY)).toBeNull();
    });
  });

  describe('Session Persistence across Gateway Instances', () => {
    it('restores previous session when a new gateway instance is created', async () => {
      const gateway1 = new AdminGateway({ mock: true, defaultAdmin: false, storage: memStorage });
      await gateway1.login({ secret: 'persistent-token', email: 'owner@visualizer.io' });
      expect(gateway1.isAdmin()).toBe(true);

      // Create a second instance sharing the same storage
      const gateway2 = new AdminGateway({ storage: memStorage });
      expect(gateway2.isAdmin()).toBe(true);
      expect(gateway2.getState().adminToken).toBe('persistent-token');
      expect(gateway2.getState().adminEmail).toBe('owner@visualizer.io');
    });
  });

  describe('Subscription Listeners', () => {
    it('notifies listeners on login and logout', async () => {
      const gateway = new AdminGateway({ mock: true, defaultAdmin: false, storage: memStorage });
      const listener = vi.fn();
      const unsubscribe = gateway.subscribe(listener);

      await gateway.login({ secret: 'token-abc' });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          isAdmin: true,
          adminToken: 'token-abc',
        }),
      );

      gateway.logout();
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenLastCalledWith({ isAdmin: false });

      // Unsubscribe check
      unsubscribe();
      await gateway.login({ secret: 'token-def' });
      expect(listener).toHaveBeenCalledTimes(2); // no new calls
    });

    it('isolates errors in listener callbacks so other listeners proceed', async () => {
      const gateway = new AdminGateway({ mock: true, defaultAdmin: false, storage: memStorage });
      const faultyListener = vi.fn().mockImplementation(() => {
        throw new Error('Boom');
      });
      const healthyListener = vi.fn();

      gateway.subscribe(faultyListener);
      gateway.subscribe(healthyListener);

      await gateway.login({ secret: 'ok-token' });
      expect(faultyListener).toHaveBeenCalledTimes(1);
      expect(healthyListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Request Header Generation (getHeaders)', () => {
    it('returns anonKey headers when non-admin', () => {
      const config: RemoteConfig = {
        supabaseUrl: 'https://test.supabase.co',
        anonKey: 'anon-abc',
      };
      const gateway = new AdminGateway({ config, storage: memStorage });
      const headers = gateway.getHeaders();
      expect(headers).toEqual({
        apikey: 'anon-abc',
        Authorization: 'Bearer anon-abc',
      });
    });

    it('returns empty headers when unconfigured and non-admin', () => {
      const config: RemoteConfig = {
        supabaseUrl: '',
        anonKey: '',
      };
      const gateway = new AdminGateway({ config, storage: memStorage });
      expect(gateway.getHeaders()).toEqual({});
    });

    it('returns admin Authorization and Cloudflare Access headers when admin', async () => {
      const config: RemoteConfig = {
        supabaseUrl: 'https://test.supabase.co',
        anonKey: 'anon-abc',
      };
      const gateway = new AdminGateway({ config, storage: memStorage, mock: true, defaultAdmin: false });
      await gateway.login({
        secret: 'admin-service-token-789',
        email: 'charlie@music-visualizer.com',
      });

      const headers = gateway.getHeaders();
      expect(headers).toEqual({
        apikey: 'anon-abc',
        Authorization: 'Bearer admin-service-token-789',
        'x-admin-token': 'admin-service-token-789',
        'x-admin-email': 'charlie@music-visualizer.com',
        'Cf-Access-Authenticated-User-Email': 'charlie@music-visualizer.com',
      });
    });
  });
});
