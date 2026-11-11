// One status line at the top of the screen, announced to screen readers.
let timer = 0;

export interface NoticeOptions {
  /** Adds a close button that hides the notice right away. */
  dismissible?: boolean;
}

export function showNotice(message: string, kind: 'error' | 'info' = 'error', ms = 7000, opts: NoticeOptions = {}): void {
  const el = document.getElementById('notice');
  if (!el) return;
  el.textContent = message;
  if (opts.dismissible) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'notice-dismiss';
    btn.setAttribute('aria-label', 'Dismiss notice');
    btn.textContent = '✕';
    btn.addEventListener('click', hideNotice);
    el.append(' ', btn);
  }
  el.className = kind === 'info' ? 'notice info' : 'notice';
  el.hidden = false;
  clearTimeout(timer);
  if (ms > 0) timer = window.setTimeout(() => (el.hidden = true), ms);
}

export function hideNotice(): void {
  clearTimeout(timer);
  const el = document.getElementById('notice');
  if (el) el.hidden = true;
}

/** Storage key recording that the browser support notice was already shown. */
export const SUPPORT_NOTICE_KEY = 'mv.supportNoticeShown';

export type NoticeStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): NoticeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Returns the support notice text the first time there are problems, and records that it was shown.
 * Returns null when there is nothing to show or the notice was already shown in this browser.
 */
export function supportNoticeText(problems: string[], storage: NoticeStorage | null = defaultStorage()): string | null {
  if (problems.length === 0) return null;
  try {
    if (storage?.getItem(SUPPORT_NOTICE_KEY) === '1') return null;
    storage?.setItem(SUPPORT_NOTICE_KEY, '1');
  } catch {
    // Storage blocked: still show the notice once for this page load.
  }
  return problems.join(' ');
}

/** Problems we can detect before the user tries anything. */
export function browserSupportProblems(): string[] {
  const problems: string[] = [];
  if (!('AudioContext' in window)) problems.push('This browser has no Web Audio support.');
  if (!document.createElement('canvas').getContext('webgl2')) {
    problems.push('WebGL2 is not available, so visuals cannot run. Use a recent Chrome or Edge.');
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    problems.push('Tab and system audio need Chrome or Edge on desktop. File and microphone still work.');
  }
  return problems;
}
