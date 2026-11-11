/**
 * Remote Configuration for Supabase PostgREST & Cloudflare Edge Services.
 * Reads environment variables from `import.meta.env` with safe fallbacks.
 */

export interface RemoteConfig {
  supabaseUrl: string;
  anonKey: string;
}

/**
 * Retrieve remote configuration, reading Vite environment variables
 * with optional overrides for testing and manual configuration.
 */
export function getRemoteConfig(overrides?: Partial<RemoteConfig>): RemoteConfig {
  const env = (typeof import.meta !== 'undefined' && import.meta.env)
    ? (import.meta.env as Record<string, string | undefined>)
    : {};
  return {
    supabaseUrl: overrides?.supabaseUrl ?? env.VITE_SUPABASE_URL ?? '',
    anonKey: overrides?.anonKey ?? env.VITE_SUPABASE_ANON_KEY ?? '',
  };
}

/**
 * Helper to check whether remote connectivity has been configured.
 */
export function isRemoteConfigured(config: RemoteConfig = getRemoteConfig()): boolean {
  return Boolean(config.supabaseUrl && config.anonKey);
}
