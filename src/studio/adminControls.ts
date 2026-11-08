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
 * Prompt user for administrator credentials (passkey secret or Cloudflare Access email).
 */
export async function promptAdminLogin(
  adminGateway: IAdminGateway,
  promptFn: (msg: string, defaultVal?: string) => string | null = (msg, d) => {
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
      return window.prompt(msg, d);
    }
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).prompt === 'function') {
      return (globalThis as any).prompt(msg, d);
    }
    return null;
  },
): Promise<{ success: boolean; error?: string }> {
  const input = promptFn('Enter Admin Secret Passkey:');
  if (!input || !input.trim()) {
    return { success: false, error: 'Cancelled' };
  }
  const clean = input.trim();
  const res = await adminGateway.login({ secret: clean });
  if (res.success) {
    showToast('👑 Admin Mode Activated');
  } else {
    showToast(res.error || 'Admin login failed');
  }
  return res;
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
  showToast('System preset saved remotely & propagated to all users');
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
