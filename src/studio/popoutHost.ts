// Slice 22.7: main-window side of the Studio pop-out. src/main.ts imports this module, so it must stay light:
// no Tweakpane, no studio.ts. The pop-out sends edits; this module applies them through narrow session
// operations only. It never saves, promotes, deletes or writes to the server, and it never touches admin state.
import { SCHEMAS } from '../presets/builtin';
import { isLayerRendered, type PresetSession } from '../presets/session';
import type { Preset, Settings } from '../presets/format';
import { applyValues, readWarpOps, valuesOf } from '../presets/loader';
import { LAYER_SPECS } from '../presets/layerSchemas';
import { warpOpSpecs } from '../presets/warpOps';
import { coerceValue, type ParamSpec, type ParamValue } from '../presets/schema';
import type { Scene } from '../render/scene';
import {
  LAYER_SECTION,
  POPOUT_DISCONNECT_TIMEOUT_MS,
  POPOUT_HEARTBEAT_INTERVAL_MS,
  createPopoutChannel,
  type EditFields,
  type PopoutTransportFactory,
} from './popoutChannel';

const FEEDBACK_POST_SECTION = 'feedbackPost';
const WARP_SECTION = /^warp(\d{1,3})$/;
const POST_NAMES: ReadonlySet<string> = new Set(SCHEMAS.post.map((spec) => spec.name));
const FEEDBACK_POST_SPECS: readonly ParamSpec[] = [...SCHEMAS.feedback, ...SCHEMAS.post];

/** Writes one control's value, clamped by its spec. Creates the setting entry when the preset lacks it. */
function writeSetting(settings: Settings, spec: ParamSpec, raw: unknown): ParamValue {
  const { value } = coerceValue(spec, raw);
  const existing = settings[spec.name];
  if (existing) existing.value = value;
  else settings[spec.name] = { value };
  return value;
}

/** Index among the rendered layers (Studio's live index), or -1 when the layer is not drawn. */
function liveLayerIndex(preset: Preset, index: number, session: PresetSession, id: string): number {
  let k = 0;
  for (let i = 0; i < preset.layers.length; i++) {
    const layer = preset.layers[i]!;
    if (!isLayerRendered(layer, i, session.monitorOf(id))) continue;
    if (i === index) return k;
    k++;
  }
  return -1;
}

/**
 * Applies one pop-out edit to the working copy, then to the live scene when the preset is on screen.
 * Mirrors Studio's own edit path (bindSection apply, Feedback/Post refresh, warp live update, commit).
 * Returns false when the edit names an unknown preset, section, layer, operator or control. Nothing changes then.
 * `liveScene` is injectable so tests need no WebGL; the default uses the session's scene.
 */
export function applyEdit(
  session: PresetSession,
  edit: EditFields,
  liveScene: (id: string) => Scene = (id) => session.sceneOf(id),
): boolean {
  const id = edit.presetId;
  const entry = session.get(id);
  if (!entry) return false;
  const preset = entry.preset;
  const onScreen = session.shownId === id;

  if (edit.section === LAYER_SECTION) {
    if (edit.layerIndex === null) return false;
    const layer = preset.layers[edit.layerIndex];
    if (!layer) return false;
    const spec = (LAYER_SPECS[layer.type] ?? []).find((s) => s.name === edit.control);
    if (!spec) return false;
    writeSetting(layer.params, spec, edit.value);
    session.commit(id);
    if (onScreen) {
      const k = liveLayerIndex(preset, edit.layerIndex, session, id);
      const current = k >= 0 ? liveScene(id).layers[k] : undefined;
      if (current) applyValues(current, valuesOf(layer.params));
    }
    return true;
  }

  if (edit.section === FEEDBACK_POST_SECTION) {
    const spec = FEEDBACK_POST_SPECS.find((s) => s.name === edit.control);
    if (!spec) return false;
    writeSetting(POST_NAMES.has(spec.name) ? preset.post : preset.feedback, spec, edit.value);
    session.commit(id);
    if (onScreen) liveScene(id).setFeedback(valuesOf(preset.feedback));
    session.refreshPost(id);
    return true;
  }

  const warp = WARP_SECTION.exec(edit.section);
  if (warp) {
    const op = preset.warp?.[Number(warp[1])];
    if (!op) return false;
    const spec = warpOpSpecs(op.type).find((s) => s.name === edit.control);
    if (!spec) return false;
    writeSetting(op.params, spec, edit.value);
    session.commit(id);
    if (onScreen) liveScene(id).setWarpOps(readWarpOps(preset));
    return true;
  }

  return false;
}

export interface PopoutHostOptions {
  session: PresetSession;
  /** Shows a preset through the main window's own switch path (the same as the preset keys). */
  switchTo: (id: string) => void;
  /** The preset id on screen in the main window. */
  getShownId: () => string | null;
  /** Called on each connected / disconnected transition. */
  onConnectionChange: (connected: boolean) => void;
  /** Injectable for tests. Defaults to the real BroadcastChannel. */
  channelFactory?: PopoutTransportFactory;
  /** Same-origin check value. Defaults to location.origin. */
  origin?: string;
  liveScene?: (id: string) => Scene;
  now?: () => number;
}

export interface PopoutHost {
  /** Call after the shown preset changes. Sends a fresh snapshot while a pop-out is connected. */
  notifyShownChanged(): void;
  isConnected(): boolean;
  close(): void;
}

export function createPopoutHost(options: PopoutHostOptions): PopoutHost {
  const { session } = options;
  const now = options.now ?? Date.now;
  const origin = options.origin ?? (typeof location !== 'undefined' ? location.origin : '');
  const channel = createPopoutChannel({ role: 'main', origin, channelFactory: options.channelFactory });

  let connected = false;
  let lastHeardAt: number | null = null;

  const setConnected = (on: boolean): void => {
    if (connected === on) return;
    connected = on;
    options.onConnectionChange(on);
  };

  const sendSnapshot = (): void => {
    const shownId = options.getShownId();
    const shown = shownId ? session.get(shownId) : undefined;
    if (!shown) return;
    channel.send('snapshot', {
      presets: session.list().map((entry) => ({ id: entry.id, name: entry.preset.name })),
      shownPresetId: shown.id,
      shownPresetJson: JSON.stringify(shown.preset),
    });
  };

  const unsubscribe = channel.onMessage((message) => {
    if (message.type === 'bye') {
      lastHeardAt = null;
      setConnected(false);
      return;
    }
    // Any message from the pop-out counts as a sign of life. A hello always gets a fresh snapshot.
    lastHeardAt = now();
    const wasConnected = connected;
    setConnected(true);
    if (!wasConnected || message.type === 'hello') sendSnapshot();

    if (message.type === 'select-preset') {
      if (session.get(message.presetId)) options.switchTo(message.presetId);
    } else if (message.type === 'edit') {
      applyEdit(session, message, options.liveScene);
    }
  });

  const timer = setInterval(() => {
    channel.send('heartbeat');
    if (connected && (lastHeardAt === null || now() - lastHeardAt > POPOUT_DISCONNECT_TIMEOUT_MS)) {
      setConnected(false);
    }
  }, POPOUT_HEARTBEAT_INTERVAL_MS);

  return {
    notifyShownChanged() {
      if (connected) sendSnapshot();
    },
    isConnected() {
      return connected;
    },
    close() {
      clearInterval(timer);
      unsubscribe();
      channel.send('bye');
      channel.close();
    },
  };
}
