/**
 * Administrator Gateway (UI hint only).
 *
 * The only admin route is Cloudflare Access through the Worker: `/admin/api/identity` reports who
 * the edge verified, and `/admin/api/presets` is the only write path. This class holds no secret and
 * writes nothing to storage. `isAdmin()` decides whether to show admin controls; the Worker decides
 * whether a write is allowed.
 */

export interface AdminSessionState {
  isAdmin: boolean;
  adminEmail?: string;
  role?: 'admin' | 'superadmin';
}

export interface IAdminGateway {
  isAdmin(): boolean;
  getState(): AdminSessionState;
  logout(): void;
  subscribe(listener: (state: AdminSessionState) => void): () => void;
  checkCloudflareAccess(): Promise<boolean>;
}

export interface AdminGatewayOptions {
  adminEmail?: string;
  mock?: boolean;
  defaultAdmin?: boolean;
  fetchFn?: typeof fetch;
}

/** Key an older build used to keep a bearer token in sessionStorage. It is removed on startup, never read. */
const LEGACY_ADMIN_SESSION_STORAGE_KEY = 'mv.adminSessionToken';
export const DEFAULT_ADMIN_EMAIL = 'charliechonguyen@gmail.com';

function purgeLegacyAdminSession(): void {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.removeItem(LEGACY_ADMIN_SESSION_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable: nothing to purge.
  }
}

function configuredAdminEmail(): string | undefined {
  if (typeof import.meta === 'undefined') return undefined;
  return (import.meta.env as Record<string, string | undefined> | undefined)?.VITE_ADMIN_EMAIL;
}

/**
 * AdminGateway tracks, in memory only, whether the Worker has verified a Cloudflare Access identity.
 */
export class AdminGateway implements IAdminGateway {
  private state: AdminSessionState;
  private adminEmail?: string;
  private mock: boolean;
  private fetchFn?: typeof fetch;
  private listeners = new Set<(state: AdminSessionState) => void>();

  constructor(options: AdminGatewayOptions = {}) {
    this.mock = Boolean(options.mock);
    this.adminEmail = options.adminEmail;
    this.fetchFn =
      options.fetchFn ??
      (typeof fetch !== 'undefined'
        ? (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)
        : undefined);

    if (this.mock && options.defaultAdmin) {
      this.state = {
        isAdmin: true,
        adminEmail: options.adminEmail || 'admin@music-visualizer.com',
        role: 'admin',
      };
      return;
    }

    this.state = { isAdmin: false };
    if (!this.mock) purgeLegacyAdminSession();
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

  public logout(): void {
    this.state = { isAdmin: false };
    this.notifyListeners();
  }

  /**
   * Asks the Worker (`/admin/api/identity`) whether Cloudflare Access verified the viewer.
   * Unlocks the admin UI when the verified email matches the admin email. The Worker still
   * checks Access on every write.
   */
  public async checkCloudflareAccess(): Promise<boolean> {
    if (this.mock) return this.isAdmin();
    if (!this.fetchFn) return this.isAdmin();

    try {
      const res = await this.fetchFn('/admin/api/identity', {
        credentials: 'include',
        redirect: 'manual',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });
      if (res && res.ok) {
        const data = await res.json();
        if (
          data &&
          data.authenticated !== false &&
          typeof data.email === 'string' &&
          data.email.trim().length > 0
        ) {
          const email = data.email.trim();
          const targetEmail = this.adminEmail || configuredAdminEmail() || DEFAULT_ADMIN_EMAIL;

          if (email.toLowerCase() === targetEmail.toLowerCase()) {
            this.state = { isAdmin: true, adminEmail: email, role: 'admin' };
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
