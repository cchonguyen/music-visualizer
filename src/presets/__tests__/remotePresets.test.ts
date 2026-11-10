import { describe, it, expect, vi } from 'vitest';
import type { Preset } from '../format';
import {
  type RemotePresetRecord,
  type RemoteConfig,
  CACHED_SYSTEM_PRESETS_KEY,
  CACHED_SYSTEM_PRESETS_VERSION,
  REMOTE_PRESET_SELECT_COLUMNS,
  normalizeSubfolder,
  serializePresetRecord,
  deserializePresetRecord,
  loadCachedPresets,
  saveCachedPresets,
  clearCachedPresets,
  fetchRemotePresets,
  upsertRemotePreset,
  softDeleteRemotePreset,
} from '../remotePresets';
import { getRemoteConfig, isRemoteConfigured } from '../../config/remoteConfig';

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

const mockPreset: Preset = {
  version: 1,
  name: 'Neon Mandala',
  tags: ['stage9', 'mandala'],
  transition: { style: 'crossfade', seconds: 2 },
  feedback: {
    decay: { value: 0.95 },
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

const sampleRecord: RemotePresetRecord = {
  id: 'test-showcase-01',
  name: 'Test Showcase 01',
  subfolder: 'showcase',
  preset_data: mockPreset,
  sort_order: 15,
  tags: ['stage9', 'mandala'],
  updated_at: '2026-11-08T00:00:00.000Z',
};

const testConfig: RemoteConfig = {
  supabaseUrl: 'https://mock-project.supabase.co',
  anonKey: 'mock-anon-key-12345',
  adminPasskeyHash: 'dummy-sha256-hash',
};

describe('remoteConfig', () => {
  it('returns safe defaults and respects overrides', () => {
    const config = getRemoteConfig({
      supabaseUrl: 'https://example.supabase.co',
      anonKey: 'anon-abc',
    });
    expect(config.supabaseUrl).toBe('https://example.supabase.co');
    expect(config.anonKey).toBe('anon-abc');
  });

  it('correctly evaluates isRemoteConfigured', () => {
    expect(isRemoteConfigured({ supabaseUrl: '', anonKey: '' })).toBe(false);
    expect(isRemoteConfigured({ supabaseUrl: 'https://example.supabase.co', anonKey: '' })).toBe(false);
    expect(isRemoteConfigured(testConfig)).toBe(true);
  });
});

describe('remotePresets serialization & normalization', () => {
  it('normalizes valid and invalid subfolders', () => {
    expect(normalizeSubfolder('showcase')).toBe('showcase');
    expect(normalizeSubfolder('flagship')).toBe('flagship');
    expect(normalizeSubfolder('classics')).toBe('classics');
    expect(normalizeSubfolder('invalid-subfolder')).toBe('classics');
    expect(normalizeSubfolder(null)).toBe('classics');
  });

  it('roundtrips serialization and deserialization', () => {
    const serialized = serializePresetRecord(sampleRecord);
    const parsed = deserializePresetRecord(serialized);
    expect(parsed).toEqual(sampleRecord);
  });

  it('deserializes gracefully with fallbacks and ignores malformed JSON', () => {
    expect(deserializePresetRecord('invalid json string')).toBeNull();
    expect(deserializePresetRecord('{}')).toBeNull();

    const partialRaw = JSON.stringify({
      id: 'partial-01',
      preset_data: mockPreset,
    });
    const parsed = deserializePresetRecord(partialRaw);
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe('partial-01');
    expect(parsed?.name).toBe('partial-01');
    expect(parsed?.subfolder).toBe('classics');
    expect(parsed?.sort_order).toBe(0);
    expect(parsed?.tags).toEqual([]);
  });
});

describe('remotePresets caching layer', () => {
  it('returns null on empty or invalid cache', () => {
    const storage = createMemoryStorage();
    expect(loadCachedPresets(storage)).toBeNull();

    storage.setItem(CACHED_SYSTEM_PRESETS_KEY, 'corrupted json');
    expect(loadCachedPresets(storage)).toBeNull();

    storage.setItem(
      CACHED_SYSTEM_PRESETS_KEY,
      JSON.stringify({ version: 999, presets: [] }),
    );
    expect(loadCachedPresets(storage)).toBeNull();
  });

  it('saves and reloads presets cache correctly', () => {
    const storage = createMemoryStorage();
    const saved = saveCachedPresets([sampleRecord], storage, 'etag-xyz');
    expect(saved).toBe(true);

    const loaded = loadCachedPresets(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(CACHED_SYSTEM_PRESETS_VERSION);
    expect(loaded?.etag).toBe('etag-xyz');
    expect(loaded?.presets).toHaveLength(1);
    expect(loaded?.presets[0]?.id).toBe('test-showcase-01');
  });

  it('clears cached presets correctly', () => {
    const storage = createMemoryStorage();
    saveCachedPresets([sampleRecord], storage);
    expect(loadCachedPresets(storage)).not.toBeNull();

    clearCachedPresets(storage);
    expect(loadCachedPresets(storage)).toBeNull();
  });

  it('swallows storage exceptions gracefully', () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error('Access denied');
      },
      setItem: () => {
        throw new Error('Quota exceeded');
      },
      removeItem: () => {
        throw new Error('Storage disabled');
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;

    expect(loadCachedPresets(brokenStorage)).toBeNull();
    expect(saveCachedPresets([sampleRecord], brokenStorage)).toBe(false);
    expect(() => clearCachedPresets(brokenStorage)).not.toThrow();
  });
});

describe('fetchRemotePresets', () => {
  it('returns empty array when remote config is missing', async () => {
    const unconfigured: RemoteConfig = { supabaseUrl: '', anonKey: '' };
    const result = await fetchRemotePresets(unconfigured);
    expect(result).toEqual([]);
  });

  it('fetches and parses remote presets from PostgREST', async () => {
    const mockDbRows = [
      {
        id: 'remote-13',
        name: 'Solar Crown Eclipse',
        subfolder: 'showcase',
        preset_data: mockPreset,
        sort_order: 13,
        tags: ['solar', 'eclipse'],
        updated_at: '2026-11-08T01:00:00Z',
      },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockDbRows,
    });

    const results = await fetchRemotePresets(testConfig, mockFetch as unknown as typeof fetch);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain('/rest/v1/system_presets');
    const select = new URL(calledUrl).searchParams.get('select');
    expect(select).toBe(REMOTE_PRESET_SELECT_COLUMNS);
    expect(select).not.toBe('*');
    expect(select?.split(',')).not.toContain('updated_by');
    expect(calledInit.headers).toMatchObject({
      apikey: testConfig.anonKey,
      Authorization: `Bearer ${testConfig.anonKey}`,
      Accept: 'application/json',
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('remote-13');
    expect(results[0]?.subfolder).toBe('showcase');
    expect(results[0]?.tags).toEqual(['solar', 'eclipse']);
  });

  it('handles network offline failures gracefully without throwing', async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
    const results = await fetchRemotePresets(testConfig, failingFetch as unknown as typeof fetch);
    expect(results).toEqual([]);
  });

  it('handles non-200 HTTP responses gracefully', async () => {
    const errorFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    const results = await fetchRemotePresets(testConfig, errorFetch as unknown as typeof fetch);
    expect(results).toEqual([]);
  });
});

describe('upsertRemotePreset', () => {
  it('returns error if unconfigured', async () => {
    const unconfigured: RemoteConfig = { supabaseUrl: '', anonKey: '' };
    const res = await upsertRemotePreset(sampleRecord, unconfigured);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Remote endpoint not configured');
  });

  it('posts upsert payload with merge-duplicates headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      text: async () => '',
    });

    const res = await upsertRemotePreset(sampleRecord, testConfig, 'admin-token-jwt', mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${testConfig.supabaseUrl}/rest/v1/system_presets`);
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toMatchObject({
      apikey: testConfig.anonKey,
      Authorization: 'Bearer admin-token-jwt',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    });

    const parsedBody = JSON.parse(calledInit.body as string);
    expect(parsedBody.id).toBe(sampleRecord.id);
    expect(parsedBody.is_deleted).toBe(false);
  });

  it('handles HTTP error responses from PostgREST', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => 'Admin permission required',
    });

    const res = await upsertRemotePreset(sampleRecord, testConfig, undefined, mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Admin permission required');
  });

  it('handles network throw gracefully', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection timeout'));
    const res = await upsertRemotePreset(sampleRecord, testConfig, undefined, mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Connection timeout');
  });
});

describe('softDeleteRemotePreset', () => {
  it('returns error if unconfigured', async () => {
    const unconfigured: RemoteConfig = { supabaseUrl: '', anonKey: '' };
    const res = await softDeleteRemotePreset('test-id', unconfigured);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Remote endpoint not configured');
  });

  it('patches is_deleted: true on target preset', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => '',
    });

    const res = await softDeleteRemotePreset('target-id', testConfig, 'admin-token-jwt', mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${testConfig.supabaseUrl}/rest/v1/system_presets?id=eq.target-id`);
    expect(calledInit.method).toBe('PATCH');
    expect(calledInit.headers).toMatchObject({
      apikey: testConfig.anonKey,
      Authorization: 'Bearer admin-token-jwt',
      Prefer: 'return=minimal',
    });

    const parsedBody = JSON.parse(calledInit.body as string);
    expect(parsedBody.is_deleted).toBe(true);
    expect(typeof parsedBody.updated_at).toBe('string');
  });

  it('handles error response during delete', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'JWT expired',
    });

    const res = await softDeleteRemotePreset('target-id', testConfig, undefined, mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(false);
    expect(res.error).toContain('JWT expired');
  });

  it('handles network throw during delete', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const res = await softDeleteRemotePreset('target-id', testConfig, undefined, mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Network error');
  });
});

describe('system preset writes via the same-origin admin proxy (Slice 11.9)', () => {
  const emptyConfig: RemoteConfig = { supabaseUrl: '', anonKey: '' };

  it('upsert POSTs the record to the proxy with same-origin credentials and only Content-Type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    const res = await upsertRemotePreset(sampleRecord, emptyConfig, 'cf-access-verified', mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('/admin/api/presets');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.credentials).toBe('same-origin');
    expect(calledInit.headers).toEqual({ 'Content-Type': 'application/json' });

    const body = JSON.parse(calledInit.body as string);
    expect(body).toMatchObject({
      id: sampleRecord.id,
      name: sampleRecord.name,
      subfolder: 'showcase',
      sort_order: 15,
      tags: sampleRecord.tags,
      is_deleted: false,
    });
    expect(body.preset_data).toEqual(sampleRecord.preset_data);
  });

  it('upsert via the proxy ignores Supabase config and sends no service or anon headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });

    await upsertRemotePreset(sampleRecord, testConfig, 'cf-access-verified', mockFetch as unknown as typeof fetch);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('/admin/api/presets');
    const headers = calledInit.headers as Record<string, string>;
    expect(headers).not.toHaveProperty('apikey');
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers).not.toHaveProperty('x-supabase-url');
  });

  it('softDelete PATCHes the proxy with an encoded id and the is_deleted body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => '' });

    const res = await softDeleteRemotePreset('target id/x', emptyConfig, 'cf-access-verified', mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(true);

    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('/admin/api/presets?id=target%20id%2Fx');
    expect(calledInit.method).toBe('PATCH');
    expect(calledInit.credentials).toBe('same-origin');
    expect(calledInit.headers).toEqual({ 'Content-Type': 'application/json' });
    const body = JSON.parse(calledInit.body as string);
    expect(body.is_deleted).toBe(true);
    expect(typeof body.updated_at).toBe('string');
  });

  it('returns the proxy error body when the write is rejected', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () => '{"reason":"email_not_allowed"}',
    });

    const res = await upsertRemotePreset(sampleRecord, emptyConfig, 'cf-access-verified', mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(false);
    expect(res.error).toContain('email_not_allowed');
  });

  it('returns the network error when the proxy cannot be reached', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    const res = await softDeleteRemotePreset('target-id', emptyConfig, 'cf-access-verified', mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(false);
    expect(res.error).toBe('Failed to fetch');
  });

  it('direct path is unchanged for other tokens: no credentials option, still needs config', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '' });

    await upsertRemotePreset(sampleRecord, testConfig, 'admin-token-jwt', mockFetch as unknown as typeof fetch);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${testConfig.supabaseUrl}/rest/v1/system_presets`);
    expect(calledInit.credentials).toBeUndefined();

    const unconfigured = await upsertRemotePreset(sampleRecord, emptyConfig, 'admin-token-jwt', mockFetch as unknown as typeof fetch);
    expect(unconfigured.error).toBe('Remote endpoint not configured');
    const deleted = await softDeleteRemotePreset('x', emptyConfig, 'admin-token-jwt', mockFetch as unknown as typeof fetch);
    expect(deleted.error).toBe('Remote endpoint not configured');
  });
});
