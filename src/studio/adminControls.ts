/**
 * Studio Admin UI Controls & System Preset Management.
 * Sector 487 (Stage 11 Administrator System Preset Management).
 */

import type { IAdminGateway, AdminSessionState } from '../presets/adminGateway';
import type { PresetSession } from '../presets/session';
import type { SystemSubfolder } from '../presets/builtin';
import { SYSTEM_SUBFOLDER_LABELS } from '../presets/builtin';
import { showToast } from '../ui/toast';

export type { AdminSessionState };

export const ADMIN_BADGE_LABEL = '👑 Admin Mode Active';
export const DELETE_ARMED_LABEL = 'Tap again to delete';
export const DELETE_LABEL = 'Delete';

/** BroadcastChannel name used by the Worker /admin page and the SPA to announce a verified login. */
export const ADMIN_AUTH_CHANNEL = 'mv-admin-auth';
/** localStorage key written with the JSON signal so the opener gets a `storage` event. */
export const ADMIN_AUTH_STORAGE_KEY = 'mv.adminAuthSignal';
/** Max wait for the cookie-already-valid check before opening the popup. */
export const ADMIN_PRECHECK_TIMEOUT_MS = 1500;
/** Interval for re-checking Cloudflare Access while the login popup is open. */
export const ADMIN_POPUP_POLL_MS = 2000;
/** Overall limit for the login popup flow. */
export const ADMIN_POPUP_TIMEOUT_MS = 120000;
export const ADMIN_CANCELLED_ERROR = 'Authentication cancelled or not completed.';
export const ADMIN_TIMED_OUT_ERROR = 'Login timed out';

export const SYSTEM_SUBFOLDER_OPTIONS: Record<string, SystemSubfolder> = {
  [SYSTEM_SUBFOLDER_LABELS.showcase]: 'showcase',
  [SYSTEM_SUBFOLDER_LABELS.flagship]: 'flagship',
  [SYSTEM_SUBFOLDER_LABELS.classics]: 'classics',
};

/**
 * True when a value is the verified admin login signal `{ type: 'mv-admin-authenticated', verified: true }`.
 */
export function isVerifiedAdminSignal(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.type === 'mv-admin-authenticated' && v.verified === true;
}

function parseJsonSafely(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Render or remove the gold administrator badge in the studio header/container.
 */
export function renderAdminBadge(container: HTMLElement, isAdmin: boolean): HTMLElement | null {
  if (!container) return null;
  const doc = container.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;

  const head = container.querySelector<HTMLElement>('.studio-head') ?? container;
  let badge = head.querySelector<HTMLElement>('.studio-admin-badge');

  if (isAdmin) {
    if (!badge) {
      badge = doc.createElement('span');
      badge.className = 'studio-admin-badge';
      badge.setAttribute('role', 'status');
      badge.textContent = ADMIN_BADGE_LABEL;

      const closeBtn = head.querySelector('#studio-close');
      if (closeBtn && typeof closeBtn.before === 'function') {
        closeBtn.before(badge);
      } else {
        head.append(badge);
      }
    } else {
      badge.hidden = false;
      badge.textContent = ADMIN_BADGE_LABEL;
    }
    return badge;
  } else {
    if (badge) {
      if (typeof badge.remove === 'function') {
        badge.remove();
      } else {
        badge.hidden = true;
      }
    }
    return null;
  }
}

/** Ask the gateway whether the Cloudflare Access session is valid. Never throws. */
async function checkAccessSafely(adminGateway: IAdminGateway): Promise<boolean> {
  try {
    if (typeof adminGateway.checkCloudflareAccess === 'function') {
      if (await adminGateway.checkCloudflareAccess()) return true;
    }
  } catch {
    // treat as not verified
  }
  return adminGateway.isAdmin();
}

/** Run the access check, but resolve false if it takes longer than `ms`. */
function checkAccessWithTimeout(adminGateway: IAdminGateway, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  return Promise.race([checkAccessSafely(adminGateway), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Wait for the /admin login popup to finish. The popup's COOP header makes `popup.closed`
 * read true while it is still open, so closure alone never cancels the login.
 */
function waitForAdminPopup(
  adminGateway: IAdminGateway,
  popup: Window,
): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let channel: BroadcastChannel | null = null;
    let inflight: Promise<boolean> | null = null;

    const cleanup = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
      if (typeof window.removeEventListener === 'function') {
        window.removeEventListener('message', onMessage);
        window.removeEventListener('storage', onStorage);
        window.removeEventListener('focus', onFocus);
      }
      if (channel !== null) {
        try {
          channel.close();
        } catch {
          // ignore
        }
        channel = null;
      }
    };

    const settle = (result: { success: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const succeed = () => {
      if (settled) return;
      try {
        popup.close?.();
      } catch {
        // ignore
      }
      showToast(`👑 Admin Mode: ${adminGateway.getState().adminEmail || 'Verified'}`);
      settle({ success: true });
    };

    // Overlapping checks share one in-flight promise.
    const check = (): Promise<boolean> => {
      if (inflight === null) {
        inflight = checkAccessSafely(adminGateway).finally(() => {
          inflight = null;
        });
      }
      return inflight;
    };

    // A signal (or poll) only triggers a server-side check; it never grants admin by itself.
    const verifyAndSucceed = () => {
      if (settled) return;
      void check().then((ok) => {
        if (ok) succeed();
      });
    };

    const onFocus = () => {
      if (settled) return;
      void check().then((ok) => {
        if (settled) return;
        if (ok) {
          succeed();
          return;
        }
        if (popup.closed === true) {
          settle({ success: false, error: ADMIN_CANCELLED_ERROR });
        }
      });
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data === 'cf-login-success' || isVerifiedAdminSignal(event.data)) {
        verifyAndSucceed();
      }
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key !== ADMIN_AUTH_STORAGE_KEY || !event.newValue) return;
      if (isVerifiedAdminSignal(parseJsonSafely(event.newValue))) {
        verifyAndSucceed();
      }
    };

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel(ADMIN_AUTH_CHANNEL);
        channel.onmessage = (event: MessageEvent) => {
          if (isVerifiedAdminSignal(event.data)) verifyAndSucceed();
        };
      } catch {
        channel = null;
      }
    }

    if (typeof window.addEventListener === 'function') {
      window.addEventListener('message', onMessage);
      window.addEventListener('storage', onStorage);
      window.addEventListener('focus', onFocus);
    }

    timeoutTimer = setTimeout(() => {
      settle({ success: false, error: ADMIN_TIMED_OUT_ERROR });
    }, ADMIN_POPUP_TIMEOUT_MS);
    pollTimer = setInterval(verifyAndSucceed, ADMIN_POPUP_POLL_MS);
  });
}

/**
 * Log in to administrator mode via Cloudflare Access gate (/admin).
 */
export async function promptAdminLogin(
  adminGateway: IAdminGateway,
  _promptFn?: (msg: string, defaultVal?: string) => string | null,
  navigateFn?: (url: string) => void,
): Promise<{ success: boolean; error?: string }> {
  if (adminGateway.isAdmin()) {
    return { success: true };
  }

  // Local dev check (strictly localhost or 127.0.0.1 or test environment)
  const isLocalOrTest =
    typeof window === 'undefined' ||
    !window.location?.hostname ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname === '';

  if (isLocalOrTest) {
    // 1. Check if already authenticated with Cloudflare Access edge identity
    if (typeof adminGateway.checkCloudflareAccess === 'function') {
      const verified = await adminGateway.checkCloudflareAccess();
      if (verified) {
        showToast(`👑 Admin Mode: ${adminGateway.getState().adminEmail || 'Verified'}`);
        return { success: true };
      }
    }

    // 2. No local passkey: Cloudflare Access is the only admin route.
    showToast('Admin sign-in needs Cloudflare Access (open /admin on the deployed site).');
    return { success: false, error: 'Cloudflare Access required' };
  }

  // 3. Production flow (!isLocalOrTest)
  if (typeof navigateFn === 'function') {
    if (typeof adminGateway.checkCloudflareAccess === 'function') {
      const verified = await adminGateway.checkCloudflareAccess();
      if (verified) {
        showToast(`👑 Admin Mode: ${adminGateway.getState().adminEmail || 'Verified'}`);
        return { success: true };
      }
    }
    try {
      sessionStorage.setItem('mv.returnToStudio', 'true');
    } catch {
      // ignore storage errors
    }
    showToast('Redirecting to Cloudflare Access login...');
    navigateFn('/admin');
    return { success: false, error: 'Redirecting to Cloudflare Access...' };
  }

  if (typeof window !== 'undefined') {
    // Already signed in (valid Cloudflare Access cookie): no popup needed.
    if (await checkAccessWithTimeout(adminGateway, ADMIN_PRECHECK_TIMEOUT_MS)) {
      showToast(`👑 Admin Mode: ${adminGateway.getState().adminEmail || 'Verified'}`);
      return { success: true };
    }

    let popup: Window | null = null;
    if (typeof window.open === 'function') {
      const width = 520;
      const height = 680;
      const left =
        typeof window.screenX === 'number' && typeof window.outerWidth === 'number'
          ? Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2))
          : 100;
      const top =
        typeof window.screenY === 'number' && typeof window.outerHeight === 'number'
          ? Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2))
          : 100;
      popup = window.open(
        '/admin?popup=1',
        'mv-cf-access',
        `popup,width=${width},height=${height},left=${left},top=${top}`,
      );
    }

    if (popup) {
      return waitForAdminPopup(adminGateway, popup);
    }

    // Popup blocked or unavailable: check existing session first, then fall back to top-level navigation
    if (
      typeof adminGateway.checkCloudflareAccess === 'function' &&
      (await adminGateway.checkCloudflareAccess())
    ) {
      showToast(`👑 Admin Mode: ${adminGateway.getState().adminEmail || 'Verified'}`);
      return { success: true };
    }

    try {
      sessionStorage.setItem('mv.returnToStudio', 'true');
    } catch {
      // ignore storage errors
    }
    showToast('Redirecting to Cloudflare Access login...');
    if (window.location) {
      window.location.href = '/admin';
    }
    return { success: false, error: 'Redirecting to Cloudflare Access...' };
  }

  return { success: false, error: 'Redirecting to Cloudflare Access...' };
}

/**
 * Exit administrator mode and clear active admin credentials.
 */
export function adminLogout(adminGateway: IAdminGateway): void {
  adminGateway.logout();
  showToast('Exited Admin Mode');
}

/**
 * Save working copy of a system preset remotely and propagate changes.
 */
export function saveSystemPresetAction(session: PresetSession, id: string): void {
  session.saveSystemPreset(id);
  showToast('System preset saved');
}

/**
 * Delete a system preset remotely and locally.
 */
export function deleteSystemPresetAction(session: PresetSession, id: string): void {
  session.removeSystemPreset(id);
  showToast('System preset deleted');
}

/**
 * Promote a user preset to a system preset in the chosen system subfolder.
 */
export function promoteUserPresetAction(
  session: PresetSession,
  userId: string,
  promptFn: (msg: string, defaultVal?: string) => string | null = (msg, d) => {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      return window.prompt(msg, d);
    }
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).prompt === 'function') {
      return (globalThis as any).prompt(msg, d);
    }
    return null;
  },
): string | null {
  const input = promptFn(
    'Promote to System Subfolder ("showcase", "flagship", or "classics"):',
    'classics',
  );
  if (input === null) return null;
  const clean = input.trim().toLowerCase();
  const subfolder: SystemSubfolder =
    clean === 'showcase' || clean === 'flagship' || clean === 'classics'
      ? clean
      : 'classics';

  const newId = session.promoteToSystemPreset(userId, subfolder);
  showToast('Promoted to system preset 👑');
  return newId;
}
