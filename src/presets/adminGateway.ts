/**
 * Administrator Gateway & Session Security Verification.
 * Sector 487 (Stage 11 Administrator System Preset Management).
 */

import { getRemoteConfig, isRemoteConfigured, type RemoteConfig } from '../config/remoteConfig';

export interface AdminSessionState {
  isAdmin: boolean;
  adminToken?: string;
  adminEmail?: string;
  role?: 'admin' | 'superadmin';
}

export interface AdminCredentials {
  secret?: string;      // Admin passkey / service role token
  email?: string;       // Cloudflare Access / Supabase admin email
  password?: string;    // Supabase admin password
}

export interface IAdminGateway {
  isAdmin(): boolean;
  getState(): AdminSessionState;
  login(credentials: AdminCredentials): Promise<{ success: boolean; error?: string }>;
  logout(): void;
  getHeaders(): Record<string, string>;
  subscribe(listener: (state: AdminSessionState) => void): () => void;
  checkCloudflareAccess(): Promise<boolean>;
}

export interface AdminGatewayOptions {
  storage?: Storage;
  config?: RemoteConfig;
  adminEmail?: string;
  mock?: boolean;
  defaultAdmin?: boolean;
  fetchFn?: typeof fetch;
}

export const ADMIN_SESSION_STORAGE_KEY = 'mv.adminSessionToken';

/**
 * Safely access sessionStorage, falling back gracefully if unavailable.
 */
function getSafeSessionStorage(customStorage?: Storage): Storage | null {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Compute SHA-256 hash using Web Crypto API.
 */
export async function computeSha256(message: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return '';
}

/**
 * AdminGateway manages admin session authentication, persistent sessionStorage storage,
 * and request header injection for privileged operations.
 */
export class AdminGateway implements IAdminGateway {
  private state: AdminSessionState;
  private storage?: Storage;
  private config: RemoteConfig;
  private adminEmail?: string;
  private mock: boolean;
  private fetchFn?: typeof fetch;
  private listeners = new Set<(state: AdminSessionState) => void>();

  constructor(options: AdminGatewayOptions = {}) {
    this.storage = options.storage;
    this.config = options.config ?? getRemoteConfig();
    this.mock = Boolean(options.mock);
    this.adminEmail = options.adminEmail;
    this.fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch : undefined);

    if (this.mock && options.defaultAdmin) {
      this.state = {
        isAdmin: true,
        adminToken: 'mock-admin-token',
        adminEmail: options.adminEmail || 'admin@music-visualizer.com',
        role: 'admin',
      };
      return;
    }

    if (this.mock && !options.defaultAdmin) {
      this.state = { isAdmin: false };
      return;
    }

    this.state = this.loadInitialState();
  }

  private getStorage(): Storage | null {
    return getSafeSessionStorage(this.storage);
  }

  private loadInitialState(): AdminSessionState {
    const store = this.getStorage();
    if (!store) {
      return { isAdmin: false };
    }
    try {
      const raw = store.getItem(ADMIN_SESSION_STORAGE_KEY);
      if (!raw) {
        return { isAdmin: false };
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const token = parsed.adminToken || parsed.token;
          const email = parsed.adminEmail || parsed.email;
          const role = parsed.role === 'superadmin' ? 'superadmin' : 'admin';
          if (token || email) {
            return {
              isAdmin: true,
              adminToken: typeof token === 'string' ? token : undefined,
              adminEmail: typeof email === 'string' ? email : undefined,
              role,
            };
          }
        }
      } catch {
        // Fallback for raw token string
        if (raw.trim()) {
          return {
            isAdmin: true,
            adminToken: raw.trim(),
            role: 'admin',
          };
        }
      }
    } catch (err) {
      console.warn('Failed to read admin session from storage:', err);
    }
    return { isAdmin: false };
  }

  private saveSession(state: AdminSessionState): void {
    const store = this.getStorage();
    if (!store) return;
    try {
      store.setItem(
        ADMIN_SESSION_STORAGE_KEY,
        JSON.stringify({
          adminToken: state.adminToken,
          adminEmail: state.adminEmail,
          role: state.role,
        }),
      );
    } catch (err) {
      console.warn('Failed to persist admin session to sessionStorage:', err);
    }
  }

  private clearSession(): void {
    const store = this.getStorage();
    if (!store) return;
    try {
      store.removeItem(ADMIN_SESSION_STORAGE_KEY);
    } catch (err) {
      console.warn('Failed to remove admin session token from sessionStorage:', err);
    }
  }

  private notifyListeners(): void {
    const currentState = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(currentState);
      } catch (err) {
        console.error('Error in AdminGateway listener callback:', err);
      }
    }
  }

  public isAdmin(): boolean {
    return Boolean(this.state.isAdmin);
  }

  public getState(): AdminSessionState {
    return { ...this.state };
  }

  public async login(credentials: AdminCredentials): Promise<{ success: boolean; error?: string }> {
    if (!credentials || (!credentials.secret?.trim() && !credentials.email?.trim() && !credentials.password?.trim())) {
      return { success: false, error: 'No credentials provided' };
    }

    // 1. Mock Mode
    if (this.mock) {
      if (
        credentials.secret === 'invalid' ||
        credentials.secret === 'wrong-passkey' ||
        credentials.password === 'wrong-password' ||
        credentials.email === 'unauthorized@example.com'
      ) {
        return { success: false, error: 'Invalid admin credentials' };
      }
      const nextState: AdminSessionState = {
        isAdmin: true,
        adminToken: credentials.secret?.trim() || 'mock-admin-token',
        adminEmail: credentials.email?.trim() || this.adminEmail || 'admin@music-visualizer.com',
        role: 'admin',
      };
      this.state = nextState;
      this.saveSession(nextState);
      this.notifyListeners();
      return { success: true };
    }

    // 2. Passkey / Secret Verification
    if (credentials.secret?.trim()) {
      const secret = credentials.secret.trim();

      // 2a. SHA-256 hash match against configured admin passkey
      if (this.config.adminPasskeyHash) {
        const computed = await computeSha256(secret);
        if (computed.toLowerCase() === this.config.adminPasskeyHash.toLowerCase()) {
          const nextState: AdminSessionState = {
            isAdmin: true,
            adminToken: secret,
            adminEmail: credentials.email?.trim() || this.adminEmail,
            role: 'admin',
          };
          this.state = nextState;
          this.saveSession(nextState);
          this.notifyListeners();
          return { success: true };
        } else {
          return { success: false, error: 'Invalid admin passkey' };
        }
      }

      // 2b. Remote probe verification against Supabase endpoint
      if (isRemoteConfigured(this.config) && this.fetchFn) {
        try {
          const baseUrl = this.config.supabaseUrl.replace(/\/+$/, '');
          const probeUrl = `${baseUrl}/rest/v1/system_presets?select=id&limit=1`;
          const res = await this.fetchFn(probeUrl, {
            method: 'GET',
            headers: {
              apikey: this.config.anonKey,
              Authorization: `Bearer ${secret}`,
            },
          });
          if (res.ok) {
            const nextState: AdminSessionState = {
              isAdmin: true,
              adminToken: secret,
              adminEmail: credentials.email?.trim() || this.adminEmail,
              role: 'admin',
            };
            this.state = nextState;
            this.saveSession(nextState);
            this.notifyListeners();
            return { success: true };
          } else {
            return { success: false, error: 'Passkey or token verification failed' };
          }
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      }

      // 2c. Dev / local fallback mode
      const nextState: AdminSessionState = {
        isAdmin: true,
        adminToken: secret,
        adminEmail: credentials.email?.trim() || this.adminEmail,
        role: 'admin',
      };
      this.state = nextState;
      this.saveSession(nextState);
      this.notifyListeners();
      return { success: true };
    }

    // 3. Email verification (Cloudflare Access email / configured admin email)
    if (credentials.email?.trim()) {
      const email = credentials.email.trim();
      const targetEmail =
        this.adminEmail ||
        ((typeof import.meta !== 'undefined' && (import.meta.env as Record<string, string | undefined>)?.VITE_ADMIN_EMAIL)
          ? (import.meta.env as Record<string, string | undefined>).VITE_ADMIN_EMAIL
          : undefined);

      if (targetEmail) {
        if (email.toLowerCase() === targetEmail.toLowerCase()) {
          const nextState: AdminSessionState = {
            isAdmin: true,
            adminEmail: email,
            adminToken: 'cf-access-verified',
            role: 'admin',
          };
          this.state = nextState;
          this.saveSession(nextState);
          this.notifyListeners();
          return { success: true };
        } else {
          return { success: false, error: 'Unauthorized admin email' };
        }
      }

      // If no target email configured, email-only login is strictly disallowed for security
      if (!email.includes('@') || !email.includes('.')) {
        return { success: false, error: 'Invalid email format' };
      }
      return { success: false, error: 'Admin email not configured. Secret passkey required.' };
    }

    return { success: false, error: 'Invalid admin credentials' };
  }

  public logout(): void {
    this.state = { isAdmin: false };
    this.clearSession();
    this.notifyListeners();
  }

  /**
   * Automatically verifies Cloudflare Access edge identity via `/cdn-cgi/access/get-identity`.
   * Unlocks admin mode if Cloudflare reports a valid session matching the admin email.
   */
  public async checkCloudflareAccess(): Promise<boolean> {
    if (this.mock) return this.isAdmin();
    if (!this.fetchFn) return this.isAdmin();

    try {
      const res = await this.fetchFn('/cdn-cgi/access/get-identity');
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.email === 'string') {
          const email = data.email.trim();
          const targetEmail =
            this.adminEmail ||
            ((typeof import.meta !== 'undefined' && (import.meta.env as Record<string, string | undefined>)?.VITE_ADMIN_EMAIL)
              ? (import.meta.env as Record<string, string | undefined>).VITE_ADMIN_EMAIL
              : undefined);

          if (!targetEmail || email.toLowerCase() === targetEmail.toLowerCase()) {
            const nextState: AdminSessionState = {
              isAdmin: true,
              adminEmail: email,
              adminToken: 'cf-access-verified',
              role: 'admin',
            };
            this.state = nextState;
            this.saveSession(nextState);
            this.notifyListeners();
            return true;
          }
        }
      }
    } catch {
      // Endpoint unavailable or offline
    }

    return this.isAdmin();
  }

  public getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.anonKey) {
      headers['apikey'] = this.config.anonKey;
    }
    if (this.state.isAdmin) {
      if (this.state.adminToken) {
        headers['Authorization'] = `Bearer ${this.state.adminToken}`;
        headers['x-admin-token'] = this.state.adminToken;
      } else if (this.config.anonKey) {
        headers['Authorization'] = `Bearer ${this.config.anonKey}`;
      }

      if (this.state.adminEmail) {
        headers['x-admin-email'] = this.state.adminEmail;
        headers['Cf-Access-Authenticated-User-Email'] = this.state.adminEmail;
      }
    } else if (this.config.anonKey) {
      headers['Authorization'] = `Bearer ${this.config.anonKey}`;
    }
    return headers;
  }

  public subscribe(listener: (state: AdminSessionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/**
 * Global default instance of AdminGateway for application runtime.
 */
export const adminGateway = new AdminGateway();
