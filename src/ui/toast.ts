// Short on-screen message (for example, the preset name after a switch). Fades out by itself.
const SHOW_MS = 1500;
let hideTimer: number | undefined;

export interface ToastOptions {
  detail?: string;
  swatch?: [number, number, number] | [[number, number, number], [number, number, number]];
  durationMs?: number;
}

export function toRgbStr(c: [number, number, number]): string {
  const isNormalized = c.every((v) => v >= 0 && v <= 1.0);
  const r = Math.round(isNormalized ? c[0] * 255 : c[0]);
  const g = Math.round(isNormalized ? c[1] * 255 : c[1]);
  const b = Math.round(isNormalized ? c[2] * 255 : c[2]);
  return `rgb(${r}, ${g}, ${b})`;
}

export function showToast(text: string, options?: ToastOptions): void {
  const el = document.getElementById('toast');
  if (!el) return;

  if (!options?.detail && !options?.swatch) {
    el.textContent = text;
    el.removeAttribute('aria-label');
  } else {
    el.replaceChildren();
    const content = document.createElement('div');
    content.className = 'toast-content';

    if (options.swatch) {
      const swatch = document.createElement('span');
      swatch.className = 'toast-swatch';
      swatch.setAttribute('aria-hidden', 'true');
      if (Array.isArray(options.swatch[0])) {
        const [c1, c2] = options.swatch as [[number, number, number], [number, number, number]];
        swatch.style.background = `linear-gradient(135deg, ${toRgbStr(c1)}, ${toRgbStr(c2)})`;
      } else {
        swatch.style.background = toRgbStr(options.swatch as [number, number, number]);
      }
      content.appendChild(swatch);
    }

    const title = document.createElement('span');
    title.className = 'toast-title';
    title.textContent = text;
    content.appendChild(title);

    if (options.detail) {
      const detail = document.createElement('span');
      detail.className = 'toast-detail';
      detail.textContent = options.detail;
      content.appendChild(detail);
    }

    el.appendChild(content);
    el.setAttribute('aria-label', options.detail ? `${text} · ${options.detail}` : text);
  }

  el.classList.add('shown');
  clearTimeout(hideTimer);
  const duration = options?.durationMs ?? SHOW_MS;
  hideTimer = setTimeout(() => el.classList.remove('shown'), duration) as unknown as number;
}
