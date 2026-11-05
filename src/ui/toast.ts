// Short on-screen message (for example, the preset name after a switch). Fades out by itself.
const SHOW_MS = 1500;
let hideTimer: number | undefined;

export function showToast(text: string): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('shown');
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => el.classList.remove('shown'), SHOW_MS);
}
