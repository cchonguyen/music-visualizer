import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SceneHost } from '../session';
import { PresetSession } from '../session';
import type { Scene } from '../../render/scene';
import { ALL_PRESETS, SCHEMAS } from '../builtin';
import type { Preset } from '../format';
import {
  type RemotePresetRecord,
  type RemoteConfig,
  CACHED_SYSTEM_PRESETS_KEY,
  loadCachedPresets,
  saveCachedPresets,
  upsertRemotePreset,
} from '../remotePresets';
import { AdminGateway } from '../adminGateway';
import { syncSystemPresets } from '../../main';

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
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

function createFakeHost(): { host: SceneHost; scenes: string[] } {
  const scenes: string[] = [];
  const host: SceneHost = {
    setScene: (scene: Scene) => {
      scenes.push(scene.name);
    },
    removeScene: (name: string) => {
      const idx = scenes.indexOf(name);
      if (idx !== -1) scenes.splice(idx, 1);
    },
    setFadeSeconds: () => {},
    setWeights: () => {},
    setPost: () => {},
    setTransition: () => {},
  };
  return { host, scenes };
}

const mockPresetData: Preset = {
  version: 1,
  name: 'Quantum Bloom',
  tags: ['stage9', 'bloom'],
  transition: { style: 'crossfade', seconds: 2 },
  feedback: {
    decay: { value: 0.92 },
  },
  post: {},
  layers: [
    {
      type: 'rings',
      enabled: true,
      opacity: 1,
      blend: 'screen',
      params: {},
    },
  ],
};

const sampleRemotePreset: RemotePresetRecord = {
  id: 'remote-showcase-99',
  name: 'Quantum Bloom',
  subfolder: 'showcase',
  preset_data: mockPresetData,
  sort_order: 99,
  tags: ['stage9', 'bloom'],
  updated_at: '2026-11-08T05:00:00.000Z',
};

const testConfig: RemoteConfig = {
  supabaseUrl: 'https://test-project.supabase.co',
  anonKey: 'mock-anon-key',
  adminPasskeyHash: 'dummy-hash',
};

describe('Slice 11.5: Application Startup Sync & Offline Reconciliation Integration', () => {
  let storage: Storage;
  let { host } = createFakeHost();

  beforeEach(() => {
    storage = createMemoryStorage();
    host = createFakeHost().host;
    vi.restoreAllMocks();
  });

  describe('1. Boot with local / cached presets', () => {
    it('boots synchronously with built-ins when cache is empty', () => {
      const session = new PresetSession(host, SCHEMAS, storage);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);

      const cached = loadCachedPresets(storage);
      expect(cached).toBeNull();

      expect(session.get('crown')).toBeDefined();
      expect(session.get('flight')).toBeDefined();
      expect(session.get('bars')).toBeDefined();
      expect(session.get('remote-showcase-99')).toBeUndefined();
    });

    it('overlays cached system presets from localStorage immediately on boot', () => {
      // Seed cache in localStorage
      saveCachedPresets([sampleRemotePreset], storage);

      const session = new PresetSession(host, SCHEMAS, storage);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);

      // Startup sequence from main.ts
      const cached = loadCachedPresets(storage);
      expect(cached).not.toBeNull();
      expect(cached?.presets).toHaveLength(1);

      session.applyRemoteSystemPresets(cached!.presets);

      const entry = session.get('remote-showcase-99');
      expect(entry).toBeDefined();
      expect(entry?.builtin).toBe(true);
      expect(entry?.preset.name).toBe('Quantum Bloom');
      expect(entry?.subfolder).toBe('showcase');

      // Verify categorization reflects the cached preset in showcase subfolder
      const categorized = session.listCategorized();
      const inShowcase = categorized.system.showcase.some((e) => e.id === 'remote-showcase-99');
      expect(inShowcase).toBe(true);
    });

    it('gracefully ignores corrupted or invalid version cache without throwing', () => {
      storage.setItem(CACHED_SYSTEM_PRESETS_KEY, 'not-valid-json{{');
      expect(loadCachedPresets(storage)).toBeNull();

      storage.setItem(
        CACHED_SYSTEM_PRESETS_KEY,
        JSON.stringify({ version: 999, presets: [sampleRemotePreset] }),
      );
      expect(loadCachedPresets(storage)).toBeNull();

      // Session still boots fine with built-ins
      const session = new PresetSession(host, SCHEMAS, storage);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);
      expect(session.get('crown')).toBeDefined();
    });
  });

  describe('2. Asynchronous background sync application', () => {
    it('fetches remote presets, applies them to session, caches them, and refreshes studio', async () => {
      const session = new PresetSession(host, SCHEMAS, storage);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);

      const mockStudio = {
        refreshPresetDropdown: vi.fn(),
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'remote-flagship-77',
            name: 'Neon Horizon',
            subfolder: 'flagship',
            preset_data: mockPresetData,
            sort_order: 77,
            tags: ['flagship', 'horizon'],
            updated_at: '2026-11-08T05:30:00.000Z',
          },
        ],
      });

      const records = await syncSystemPresets(session, testConfig, {
        storage,
        fetchFn: mockFetch as unknown as typeof fetch,
        studio: mockStudio,
      });

      expect(records).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Session received the remote preset
      const entry = session.get('remote-flagship-77');
      expect(entry).toBeDefined();
      expect(entry?.builtin).toBe(true);
      expect(entry?.preset.name).toBe('Neon Horizon');
      expect(entry?.subfolder).toBe('flagship');

      // Cached in storage
      const cached = loadCachedPresets(storage);
      expect(cached).not.toBeNull();
      expect(cached?.presets.some((p) => p.id === 'remote-flagship-77')).toBe(true);

      // Studio dropdown was refreshed
      expect(mockStudio.refreshPresetDropdown).toHaveBeenCalledTimes(1);
    });

    it('respects soft-deleted remote presets by removing them from session', async () => {
      const session = new PresetSession(host, SCHEMAS, storage);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);
      session.applyRemoteSystemPresets([sampleRemotePreset]);
      expect(session.get('remote-showcase-99')).toBeDefined();

      const mockStudio = { refreshPresetDropdown: vi.fn() };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'remote-showcase-99',
            name: 'Quantum Bloom',
            subfolder: 'showcase',
            preset_data: mockPresetData,
            sort_order: 99,
            tags: ['stage9'],
            updated_at: '2026-11-08T06:00:00.000Z',
            is_deleted: true,
          },
        ],
      });

      await syncSystemPresets(session, testConfig, {
        storage,
        fetchFn: mockFetch as unknown as typeof fetch,
        studio: mockStudio,
      });

      expect(session.get('remote-showcase-99')).toBeUndefined();
      expect(mockStudio.refreshPresetDropdown).toHaveBeenCalled();
    });
  });

  describe('3. Offline resilience and network error handling', () => {
    it('gracefully handles network rejection without affecting visualizer playback', async () => {
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const session = new PresetSession(host, SCHEMAS, storage);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);

      const mockStudio = { refreshPresetDropdown: vi.fn() };
      const rejectingFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch (offline)'));

      const result = await syncSystemPresets(session, testConfig, {
        storage,
        fetchFn: rejectingFetch as unknown as typeof fetch,
        studio: mockStudio,
      });

      expect(result).toEqual([]);
      // Presets remain active and intact
      expect(session.get('crown')).toBeDefined();
      expect(session.get('flight')).toBeDefined();

      // Logged informational message for offline fallback
      expect(infoSpy).toHaveBeenCalled();
      const hasOfflineMsg = infoSpy.mock.calls.some((call) =>
        call.some((arg) => typeof arg === 'string' && arg.includes('local/cached system presets')),
      );
      expect(hasOfflineMsg).toBe(true);

      // Visualizer session can still show presets without error
      expect(() => session.show('crown')).not.toThrow();
      expect(session.shownId).toBe('crown');
    });

    it('gracefully handles HTTP 500 error responses without throwing', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const session = new PresetSession(host, SCHEMAS, storage);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);

      const serverErrorFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const result = await syncSystemPresets(session, testConfig, {
        storage,
        fetchFn: serverErrorFetch as unknown as typeof fetch,
      });

      expect(result).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
      expect(session.get('crown')).toBeDefined();
    });
  });

  describe('4. Admin mutation updates reflected in session and cache', () => {
    it('allows authenticated admin to promote, edit, save and persist system presets', async () => {
      const adminGateway = new AdminGateway({ mock: true, defaultAdmin: true });
      expect(adminGateway.isAdmin()).toBe(true);

      const session = new PresetSession(host, SCHEMAS, storage, adminGateway);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);

      // 1. Create a user preset
      const userPresetId = session.saveAs('crown', 'My Custom Rave');
      expect(session.get(userPresetId)?.builtin).toBe(false);

      // 2. Admin promotes user preset to system preset
      const sysId = session.promoteToSystemPreset(userPresetId, 'flagship');
      const promoted = session.get(sysId);
      expect(promoted?.builtin).toBe(true);
      expect(promoted?.subfolder).toBe('flagship');

      // 3. Admin modifies system preset and saves
      promoted!.preset.name = 'Crown Sovereign Edition';
      expect(() => session.save(sysId)).not.toThrow();
      expect(session.get(sysId)?.savedJson).toContain('Crown Sovereign Edition');

      // 4. Admin mutation is pushed remotely via upsertRemotePreset
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      const upsertResult = await upsertRemotePreset(
        {
          id: sysId,
          name: promoted!.preset.name,
          subfolder: 'flagship',
          preset_data: promoted!.preset,
          sort_order: 10,
          tags: promoted!.preset.tags,
          updated_at: new Date().toISOString(),
        },
        testConfig,
        adminGateway.getState().adminToken,
        mockFetch as unknown as typeof fetch,
      );

      expect(upsertResult.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0] as [string, RequestInit];
      const [calledUrl, calledInit] = call;
      expect(calledUrl).toContain('/rest/v1/system_presets');
      expect((calledInit.headers as Record<string, string>)['Authorization']).toBe('Bearer mock-admin-token');
      expect((calledInit.headers as Record<string, string>)['Prefer']).toContain('resolution=merge-duplicates');

      // 5. Cache reflects updated preset
      saveCachedPresets(
        [
          {
            id: sysId,
            name: promoted!.preset.name,
            subfolder: 'flagship',
            preset_data: promoted!.preset,
            sort_order: 10,
            tags: promoted!.preset.tags,
            updated_at: new Date().toISOString(),
          },
        ],
        storage,
      );

      const cached = loadCachedPresets(storage);
      expect(cached?.presets.some((p) => p.name === 'Crown Sovereign Edition')).toBe(true);
    });

    it('enforces read-only protection when admin authorization is inactive', () => {
      const adminGateway = new AdminGateway({ mock: true, defaultAdmin: false });
      expect(adminGateway.isAdmin()).toBe(false);

      const session = new PresetSession(host, SCHEMAS, storage, adminGateway);
      for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);

      // Attempting to save built-in preset without admin throws
      expect(() => session.save('crown')).toThrow(/read-only/i);

      // Attempting to remove system preset throws
      expect(() => session.removeSystemPreset('crown')).toThrow(/admin authorization required/i);

      // Attempting to promote user preset throws
      const userId = session.saveAs('crown', 'Temp Preset');
      expect(() => session.promoteToSystemPreset(userId, 'showcase')).toThrow(/admin authorization required/i);
    });
  });
});
