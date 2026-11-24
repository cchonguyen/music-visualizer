// Studio Basic / Advanced view choice (Slice 15.4), kept in browser storage and shared between open panels.
import { tierOf } from '../presets/layerSchemas';
import { isSpecVisible, type ParamSpec, type ParamValue } from '../presets/schema';

/** Studio view choice (Slice 15.4). Stored under one key; every read and write tolerates missing or failing storage. */
export type StudioView = 'basic' | 'advanced';

export const STUDIO_VIEW_KEY = 'mv.studio.view';

export const viewSubscribers = new Set<(v: StudioView) => void>();

export let sessionView: StudioView | null = null;

export function loadStudioView(): StudioView {
  try {
    const raw = globalThis.localStorage?.getItem(STUDIO_VIEW_KEY);
    if (raw === 'basic' || raw === 'advanced') return raw;
  } catch {
    // storage unavailable: fall through
  }
  return sessionView ?? 'basic';
}

export function saveStudioView(view: StudioView): void {
  sessionView = view;
  try {
    globalThis.localStorage?.setItem(STUDIO_VIEW_KEY, view);
  } catch {
    // storage unavailable: the choice lasts for this session only
  }
}

/** True when a control shows in `view`: showWhen still decides first, then the tier (untiered = advanced). */
export function isSpecShown(spec: ParamSpec, values: Record<string, ParamValue>, view: StudioView): boolean {
  return isSpecVisible(spec, values) && (view === 'advanced' || tierOf(spec) === 'basic');
}
