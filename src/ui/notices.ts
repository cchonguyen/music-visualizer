// One status line at the top of the screen, announced to screen readers.
let timer = 0;

export function showNotice(message: string, kind: 'error' | 'info' = 'error', ms = 7000): void {
  const el = document.getElementById('notice');
  if (!el) return;
  el.textContent = message;
  el.className = kind === 'info' ? 'notice info' : 'notice';
  el.hidden = false;
  clearTimeout(timer);
  if (ms > 0) timer = window.setTimeout(() => (el.hidden = true), ms);
}

export function hideNotice(): void {
  const el = document.getElementById('notice');
  if (el) el.hidden = true;
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
