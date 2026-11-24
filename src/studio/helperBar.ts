// Studio helper bar (the description shown when you hover or tap a control) and the per-control reset button.
import { type ParamSpec } from '../presets/schema';
import { createStudioIconSvg } from './adminControls';

/** Default prompt shown in the Studio helper bar when no parameter is hovered/focused (Slice 9.8). */
export const STUDIO_HELPER_IDLE_TEXT = 'Tap or hover over any effect name to see a description of what it does.';

/** Descriptor for non-ParamSpec Studio controls wired to the bottom helper bar (Slice 25.6). */
export interface ControlHelperDescriptor {
  label: string;
  description: string;
  warning?: string;
  intense?: boolean;
}

/** Render parameter or control description and warning in the fixed helper bar element. */
export function renderHelperContent(helperBar: HTMLElement, spec: ParamSpec | ControlHelperDescriptor | null): void {
  if (!helperBar) return;
  if (!spec || (!spec.description && !spec.warning && !spec.intense)) {
    helperBar.textContent = STUDIO_HELPER_IDLE_TEXT;
    return;
  }

  if (typeof helperBar.replaceChildren === 'function') {
    helperBar.replaceChildren();
  } else {
    helperBar.textContent = '';
  }

  const doc = helperBar.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  const descRow = doc.createElement('div');
  const nameSpan = doc.createElement('span');
  nameSpan.className = 'helper-param-name';
  nameSpan.textContent = spec.label;

  if (spec.description) {
    const descSpan = doc.createElement('span');
    descSpan.className = 'helper-param-desc';
    descSpan.textContent = spec.description;
    descRow.append(nameSpan, ': ', descSpan);
  } else {
    descRow.append(nameSpan);
  }
  helperBar.append(descRow);

  if (spec.warning || spec.intense) {
    const warnRow = doc.createElement('div');
    warnRow.className = 'helper-warning';
    const warnText = spec.warning || 'High-intensity effect';
    const warnIcon = createStudioIconSvg(doc, 'alert-triangle');
    if (warnIcon) {
      warnRow.append(warnIcon);
    }
    const warnSpan = doc.createElement('span');
    warnSpan.textContent = warnText;
    warnRow.append(warnSpan);
    helperBar.append(warnRow);
  }
}

/** Generalized control helper: attaches optional badge and hover/focus listeners to any Studio blade or DOM element (Slice 25.6). */
export function attachControlHelper<T extends ParamSpec | ControlHelperDescriptor>(
  elementOrBlade: any,
  info: T,
  onHelperUpdate?: (info: T | null) => void,
): void {
  if (!elementOrBlade || typeof elementOrBlade !== 'object') return;
  const el: HTMLElement | undefined =
    elementOrBlade.element ?? (typeof elementOrBlade.addEventListener === 'function' ? elementOrBlade : undefined);
  if (!el || typeof el !== 'object') return;

  const doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);

  // 1. Intense / warning badge: (!) appended to label element or blade root
  if (info.intense || info.warning) {
    try {
      const hasBadge = typeof el.querySelector === 'function' && el.querySelector('.intense-badge');
      if (!hasBadge && doc && typeof doc.createElement === 'function') {
        const badge = doc.createElement('span');
        badge.className = 'intense-badge';
        badge.title = info.warning || 'High-intensity effect';
        badge.textContent = '(!)';
        const labelEl = typeof el.querySelector === 'function' ? el.querySelector('.tp-lblv_l, label') : null;
        if (labelEl && typeof labelEl.append === 'function') {
          labelEl.append(badge);
        } else if (typeof el.append === 'function') {
          el.append(badge);
        }
      }
    } catch {
      // Gracefully handle incomplete DOM mocks in test environments
    }
  }

  // 2. Reactive hover & focus tracking
  if (typeof el.addEventListener === 'function' && onHelperUpdate) {
    const activate = () => {
      el.classList?.add?.('studio-control-highlight');
      if (info.intense || info.warning) el.classList?.add?.('studio-control-highlight-intense');
      onHelperUpdate(info);
    };
    const deactivate = () => {
      el.classList?.remove?.('studio-control-highlight');
      el.classList?.remove?.('studio-control-highlight-intense');
      onHelperUpdate(null);
    };

    try {
      el.addEventListener('mouseenter', activate);
      el.addEventListener('focusin', activate);
      el.addEventListener('focus', activate);
      el.addEventListener('mouseleave', deactivate);
      el.addEventListener('blur', deactivate);
      el.addEventListener('focusout', (ev: FocusEvent) => {
        if (ev?.relatedTarget && typeof el.contains === 'function' && el.contains(ev.relatedTarget as Node)) {
          return;
        }
        deactivate();
      });
    } catch {
      // Gracefully handle incomplete DOM mocks in test environments
    }
  }
}

/** Attach amber badge and hover/focus listeners to a blade row (Slice 9.8 wrapper for backwards compatibility). */
export function attachSpecHelper(
  blade: any,
  spec: ParamSpec,
  onHelperUpdate?: (spec: ParamSpec | null) => void,
): void {
  attachControlHelper(blade, spec, onHelperUpdate);
}

/** True when `value` differs from the spec default (arrays compare per item, text case-insensitively). */
export function isChangedFromDefault(spec: ParamSpec, value: unknown): boolean {
  const def = (spec as any).default as unknown;
  if (Array.isArray(def)) {
    return !Array.isArray(value) || def.length !== value.length || def.some((d, i) => d !== (value as unknown[])[i]);
  }
  if (typeof def === 'string' && typeof value === 'string') return def.toLowerCase() !== value.toLowerCase();
  return value !== def;
}

/**
 * Add a per-control reset button and a "changed" marker to the blade rows of one control (Slice 15.5).
 * Reset writes the spec default (never the current value) into the holder and then calls `onChange`,
 * the same callback a normal edit uses, so the preview and saved state update the same way.
 */
export function attachResetControl(
  blades: any[],
  spec: ParamSpec,
  holder: Record<string, any>,
  key: string,
  onChange: () => void,
): { update: () => void; reset: () => void } {
  const rows = blades.filter((b) => b && typeof b === 'object');
  const first: HTMLElement | undefined = rows[0]?.element;
  const doc = first?.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const update = () => {
    const changed = isChangedFromDefault(spec, holder[key]);
    for (const b of rows) {
      const el: HTMLElement | undefined = b.element;
      if (!el?.classList) continue;
      if (changed) el.classList.add('studio-changed');
      else el.classList.remove('studio-changed');
    }
    const btn = (first as any)?.__resetBtn as HTMLElement | undefined;
    if (btn) btn.hidden = !changed;
  };
  const reset = () => {
    const def = (spec as any).default as unknown;
    if (!isChangedFromDefault(spec, holder[key])) return;
    if (Array.isArray(def) && Array.isArray(holder[key])) {
      // Edit the vec3 in place: the three bindings point at its items.
      def.forEach((d, i) => { (holder[key] as unknown[])[i] = d; });
    } else {
      holder[key] = Array.isArray(def) ? [...def] : def;
    }
    for (const b of rows) b.refresh?.();
    update();
    onChange();
  };
  if (first && doc) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'studio-reset';
    btn.title = 'Reset to default';
    btn.setAttribute('aria-label', `Reset ${spec.label} to default`);
    btn.textContent = '\u21BA';
    btn.addEventListener('click', (ev: Event) => { ev.stopPropagation?.(); reset(); });
    first.appendChild(btn);
    (first as any).__resetBtn = btn;
  }
  for (const b of rows) b.on?.('change', update);
  update();
  return { update, reset };
}
