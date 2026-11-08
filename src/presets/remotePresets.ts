/**
 * Remote Preset Contracts & PostgREST Operations.
 * Sector 487 (Stage 11 Administrator System Preset Management).
 */

import type { Preset } from './format';
import type { SystemSubfolder } from './builtin';
import { getRemoteConfig, isRemoteConfigured, type RemoteConfig } from '../config/remoteConfig';

export { getRemoteConfig, isRemoteConfigured };
export type { RemoteConfig };

export interface RemotePresetRecord {
  id: string;
  name: string;
  subfolder: SystemSubfolder;
  preset_data: Preset;
  sort_order: number;
  tags: string[];
  updated_at: string;
  is_deleted?: boolean;
}

export interface CachedSystemPresets {
  version: number;
  syncedAt: number;
  etag?: string;
  presets: RemotePresetRecord[];
}

export const CACHED_SYSTEM_PRESETS_KEY = 'mv.cachedSystemPresets';
export const CACHED_SYSTEM_PRESETS_VERSION = 1;

/**
 * Validate and normalize a subfolder to a known SystemSubfolder.
 */
export function normalizeSubfolder(val: unknown): SystemSubfolder {
  if (val === 'showcase' || val === 'flagship' || val === 'classics') {
    return val;
  }
  return 'classics';
}

/**
 * Safely serialize a remote preset record to a JSON string.
 */
export function serializePresetRecord(record: RemotePresetRecord): string {
  return JSON.stringify(record);
}

/**
 * Safely deserialize a JSON string into a RemotePresetRecord.
 */
export function deserializePresetRecord(raw: string): RemotePresetRecord | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') {
      return null;
    }
    return {
      id: parsed.id,
      name: typeof parsed.name === 'string' ? parsed.name : parsed.id,
      subfolder: normalizeSubfolder(parsed.subfolder),
      preset_data: parsed.preset_data as Preset,
      sort_order: typeof parsed.sort_order === 'number' ? parsed.sort_order : 0,
      tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : new Date().toISOString(),
      ...(parsed.is_deleted !== undefined ? { is_deleted: Boolean(parsed.is_deleted) } : {}),
    };
  } catch {
    return null;
  }
}

function getSafeStorage(customStorage?: Storage): Storage | null {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

/**
 * Load cached system presets from storage (localStorage or test mock).
 * Returns null if not found, corrupted, or incompatible version.
 */
export function loadCachedPresets(storage?: Storage): CachedSystemPresets | null {
  const store = getSafeStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(CACHED_SYSTEM_PRESETS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.version !== CACHED_SYSTEM_PRESETS_VERSION ||
      !Array.isArray(parsed.presets)
    ) {
      return null;
    }
    return parsed as CachedSystemPresets;
  } catch (err) {
    console.warn('Failed to load cached system presets:', err);
    return null;
  }
}

/**
 * Save remote system presets into local cache for instant offline startup.
 */
export function saveCachedPresets(
  presets: RemotePresetRecord[],
  storage?: Storage,
  etag?: string,
): boolean {
  const store = getSafeStorage(storage);
  if (!store) return false;
  try {
    const cached: CachedSystemPresets = {
      version: CACHED_SYSTEM_PRESETS_VERSION,
      syncedAt: Date.now(),
      ...(etag ? { etag } : {}),
      presets,
    };
    store.setItem(CACHED_SYSTEM_PRESETS_KEY, JSON.stringify(cached));
    return true;
  } catch (err) {
    console.warn('Failed to save cached system presets:', err);
    return false;
  }
}

/**
 * Clear cached system presets from local storage.
 */
export function clearCachedPresets(storage?: Storage): void {
  const store = getSafeStorage(storage);
  if (!store) return;
  try {
    store.removeItem(CACHED_SYSTEM_PRESETS_KEY);
  } catch {
    // Ignore storage clear errors
  }
}

/**
 * Asynchronously query PostgREST endpoint for active system presets.
 * Returns empty array and logs informational message on network or configuration failure.
 */
export async function fetchRemotePresets(
  config: RemoteConfig = getRemoteConfig(),
  fetchFn: typeof fetch = fetch,
): Promise<RemotePresetRecord[]> {
  if (!config.supabaseUrl || !config.anonKey) {
    console.info('Using local/cached system presets (remote not configured).');
    return [];
  }

  const baseUrl = config.supabaseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/rest/v1/system_presets?select=id,name,subfolder,preset_data,sort_order,tags,updated_at&is_deleted=eq.false&order=sort_order.asc,updated_at.desc`;

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.anonKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Remote presets fetch failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .filter((item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => ({
        id: String(item['id'] ?? ''),
        name: String(item['name'] || item['id'] || ''),
        subfolder: normalizeSubfolder(item['subfolder']),
        preset_data: item['preset_data'] as Preset,
        sort_order: typeof item['sort_order'] === 'number' ? item['sort_order'] : 0,
        tags: Array.isArray(item['tags']) ? (item['tags'] as unknown[]).map(String) : [],
        updated_at: typeof item['updated_at'] === 'string' ? item['updated_at'] : new Date().toISOString(),
      }));
  } catch {
    console.info('Using local/cached system presets (network/offline fallback).');
    return [];
  }
}

/** Admin token set by the Cloudflare Access handshake (adminGateway). Writes go through the same-origin proxy. */
export const CF_ACCESS_ADMIN_TOKEN = 'cf-access-verified';
/** Same-origin Worker proxy for system preset writes (Slice 11.8). */
export const ADMIN_PRESETS_PROXY_PATH = '/admin/api/presets';

/** Same-origin proxy write: the Worker holds the service key and checks the Access cookie. */
async function proxyPresetWrite(
  url: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  fetchFn: typeof fetch,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetchFn(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: errText || `HTTP ${response.status}: ${response.statusText}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Upsert a system preset record to Supabase via PostgREST.
 * Requires admin token or service role credentials.
 * With the Cloudflare Access token, writes go through the same-origin proxy and need no Supabase config.
 */
export async function upsertRemotePreset(
  preset: RemotePresetRecord,
  config: RemoteConfig = getRemoteConfig(),
  adminToken?: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ success: boolean; error?: string }> {
  const payload = {
    id: preset.id,
    name: preset.name,
    subfolder: normalizeSubfolder(preset.subfolder),
    preset_data: preset.preset_data,
    sort_order: preset.sort_order,
    tags: preset.tags,
    is_deleted: false,
    updated_at: new Date().toISOString(),
  };

  if (adminToken === CF_ACCESS_ADMIN_TOKEN) {
    return proxyPresetWrite(ADMIN_PRESETS_PROXY_PATH, 'POST', payload, fetchFn);
  }

  if (!config.supabaseUrl || !config.anonKey) {
    return { success: false, error: 'Remote endpoint not configured' };
  }

  const baseUrl = config.supabaseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/rest/v1/system_presets`;
  const authToken = adminToken || config.anonKey;

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: errText || `HTTP ${response.status}: ${response.statusText}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Soft-delete a system preset record by setting `is_deleted = true`.
 * Requires admin token or service role credentials.
 */
export async function softDeleteRemotePreset(
  id: string,
  config: RemoteConfig = getRemoteConfig(),
  adminToken?: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ success: boolean; error?: string }> {
  const payload = {
    is_deleted: true,
    updated_at: new Date().toISOString(),
  };

  if (adminToken === CF_ACCESS_ADMIN_TOKEN) {
    return proxyPresetWrite(
      `${ADMIN_PRESETS_PROXY_PATH}?id=${encodeURIComponent(id)}`,
      'PATCH',
      payload,
      fetchFn,
    );
  }

  if (!config.supabaseUrl || !config.anonKey) {
    return { success: false, error: 'Remote endpoint not configured' };
  }

  const baseUrl = config.supabaseUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/rest/v1/system_presets?id=eq.${encodeURIComponent(id)}`;
  const authToken = adminToken || config.anonKey;

  try {
    const response = await fetchFn(url, {
      method: 'PATCH',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, error: errText || `HTTP ${response.status}: ${response.statusText}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
