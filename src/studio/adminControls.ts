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

export const SYSTEM_SUBFOLDER_OPTIONS: Record<string, SystemSubfolder> = {
  [SYSTEM_SUBFOLDER_LABELS.showcase]: 'showcase',
  [SYSTEM_SUBFOLDER_LABELS.flagship]: 'flagship',
  [SYSTEM_SUBFOLDER_LABELS.classics]: 'classics',
};

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

/**
 * Log in to administrator mode via Cloudflare Access gate (/admin) or local passkey fallback.
 */
export async function promptAdminLogin(
  adminGateway: IAdminGateway,
  promptFn?: (msg: string, defaultVal?: string) => string | null,
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

    // 2. Local passkey prompt fallback
    const prompt =
      promptFn ??
      ((msg, d) => {
        if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
          return window.prompt(msg, d);
        }
        return null;
      });
    const input = prompt('Local Dev: Enter Admin Passkey:');
    if (!input || !input.trim()) {
      return { success: false, error: 'Cancelled' };
    }
    const res = await adminGateway.login({ secret: input.trim() });
    if (res.success) {
      showToast('👑 Admin Mode Activated');
    } else {
      showToast(res.error || 'Admin login failed');
    }
    return res;
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
        '/admin',
        'mv-cf-access',
        `popup,width=${width},height=${height},left=${left},top=${top}`,
      );
    }

    if (popup) {
      return await new Promise<{ success: boolean; error?: string }>((resolve) => {
        let settled = false;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let checking = false;

        const finish = (result: { success: boolean; error?: string }) => {
          if (settled) return;
          settled = true;
          if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          if (typeof window.removeEventListener === 'function') {
            window.removeEventListener('message', onMessage);
          }
          resolve(result);
        };

        const verifyNow = async (options?: { fromClose?: boolean; fromPoll?: boolean }) => {
          if (settled) return;
          if (adminGateway.isAdmin()) {
            try {
              popup.close?.();
            } catch {
              // ignore
            }
            showToast(`👑 Admin Mode: ${adminGateway.getState().adminEmail || 'Verified'}`);
            finish({ success: true });
            return;
          }
          if (checking && options?.fromPoll) return;
          checking = true;
          try {
            const verified =
              typeof adminGateway.checkCloudflareAccess === 'function'
                ? await adminGateway.checkCloudflareAccess()
                : adminGateway.isAdmin();
            if (verified || adminGateway.isAdmin()) {
              try {
                popup.close?.();
              } catch {
                // ignore
              }
              showToast(`👑 Admin Mode: ${adminGateway.getState().adminEmail || 'Verified'}`);
              finish({ success: true });
              return;
            }
            if (options?.fromClose) {
              finish({ success: false, error: 'Authentication cancelled or not completed.' });
            }
          } finally {
            checking = false;
          }
        };

        const onMessage = (event: MessageEvent) => {
          if (event.origin !== window.location.origin) return;
          const data = event.data;
          if (data === 'cf-login-success' || (data && typeof data === 'object' && data.type === 'mv-admin-authenticated' && data.verified)) {
            void verifyNow();
          }
        };

        if (typeof window.addEventListener === 'function') {
          window.addEventListener('message', onMessage);
        }

        void verifyNow();

        pollTimer = setInterval(() => {
          if (settled) return;
          if (popup.closed) {
            if (pollTimer !== null) {
              clearInterval(pollTimer);
              pollTimer = null;
            }
            void verifyNow({ fromClose: true });
            return;
          }
          void verifyNow({ fromPoll: true });
        }, 500);
      });
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
