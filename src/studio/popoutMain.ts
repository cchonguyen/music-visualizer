// Slice 22.6: Studio in its own window (popout.html). A controller only: it builds a PresetSession with a
// no-op SceneHost, so it never draws and needs no WebGL. The main window applies the edits it receives (slice 22.7).
// Admin state is per window: the admin gateway is decided by the server for this window, never by a channel
// message. No remote writer is set here, so this window does not write to the server.
import '../style.css';
import { ALL_PRESETS, SCHEMAS } from '../presets/builtin';
import { PresetSession, type SceneHost } from '../presets/session';
import { parsePreset, type Preset, type SchemaRegistry } from '../presets/format';
import { migrateWaveformsInPreset } from '../presets/legacyShapeMigration';
import { loadCachedPresets } from '../presets/remotePresets';
import { safeStorage } from '../presets/library';
import { adminGateway } from '../presets/adminGateway';
import { Studio, type StudioEdit } from './studio';
import {
  createPopoutChannel,
  POPOUT_DISCONNECT_TIMEOUT_MS,
  POPOUT_HEARTBEAT_INTERVAL_MS,
  type PopoutMessage,
} from './popoutChannel';

export const POPOUT_WAITING_TEXT = 'Waiting for the visual window';

/** The pop-out never draws. Every scene operation does nothing. */
export const NOOP_SCENE_HOST: SceneHost = {
  setScene: () => undefined,
  removeScene: () => undefined,
  setFadeSeconds: () => undefined,
  setWeights: () => undefined,
  setPost: () => undefined,
  setTransition: () => undefined,
};

/** True when the main window has been silent too long, or has never spoken. */
export function isMainSilent(lastHeardAt: number | null, now: number): boolean {
  return lastHeardAt === null || now - lastHeardAt > POPOUT_DISCONNECT_TIMEOUT_MS;
}

/** Reads the shown-preset JSON from a snapshot. Returns null when it is not a valid preset, so nothing changes. */
export function readShownPreset(json: string, registry: SchemaRegistry): Preset | null {
  try {
    return migrateWaveformsInPreset(parsePreset(JSON.parse(json), registry)).preset;
  } catch {
    return null;
  }
}

/** Same loading steps as main.ts: builtins, cached remote system presets, then this browser's user presets. */
export function buildPopoutSession(): PresetSession {
  const session = new PresetSession(NOOP_SCENE_HOST, SCHEMAS, safeStorage(), { adminGateway });
  for (const b of ALL_PRESETS) session.addBuiltin(b.id, b.preset);
  const cached = loadCachedPresets(safeStorage());
  if (cached?.presets && cached.presets.length > 0) session.applyRemoteSystemPresets(cached.presets);
  session.loadUserPresets();
  return session;
}

function startPopout(): void {
  const root = document.getElementById('studio');
  if (!root) return;
  const statusEl = document.getElementById('popout-status');
  const session = buildPopoutSession();
  const channel = createPopoutChannel({ role: 'popout', origin: location.origin });
  let lastHeardAt: number | null = null;

  const refreshStatus = (): void => {
    if (statusEl) statusEl.textContent = isMainSilent(lastHeardAt, Date.now()) ? POPOUT_WAITING_TEXT : '';
  };

  const studio: Studio = new Studio(root, {
    session,
    switchTo: (id) => {
      channel.send('select-preset', { presetId: id });
      if (session.get(id)) studio.bind(id);
    },
    adminGateway,
    // frameMs and linkMeter are not set: this window draws nothing, so there is no frame time or link meter to show.
    onEdit: (edit: StudioEdit) => {
      // The edit message carries a layer index only (see popoutChannel.ts). Feedback, post and warp edits stay local.
      if (edit.layerIndex === null) return;
      channel.send('edit', {
        presetId: edit.presetId,
        section: edit.section,
        layerIndex: edit.layerIndex,
        control: edit.name,
        value: edit.value,
      });
    },
  });

  const applySnapshot = (message: Extract<PopoutMessage, { type: 'snapshot' }>): void => {
    // Refresh the list from this browser's saved presets, then show the main window's working copy.
    session.loadUserPresets();
    const preset = readShownPreset(message.shownPresetJson, SCHEMAS);
    const entry = session.get(message.shownPresetId);
    if (!entry) return;
    if (preset) {
      entry.preset = preset; // working copy only: nothing is saved from here
      session.rebuild(entry.id);
    }
    studio.bind(entry.id);
  };

  channel.onMessage((message) => {
    lastHeardAt = message.type === 'bye' ? null : Date.now();
    refreshStatus();
    if (message.type === 'snapshot') applySnapshot(message);
    else if (message.type === 'hello') channel.send('hello');
  });

  // Admin sign-in in this window runs through Studio's own gateway, as it does in the main window.
  // Each window decides its admin state from the server. A message never grants it.
  studio.setVisible(true);
  channel.send('hello');
  refreshStatus();
  const timer = window.setInterval(() => {
    channel.send('heartbeat');
    refreshStatus();
    // This window is the Studio. A swipe-dismiss must not hide it.
    if (!studio.visible) studio.setVisible(true);
  }, POPOUT_HEARTBEAT_INTERVAL_MS);

  window.addEventListener('pagehide', () => {
    window.clearInterval(timer);
    channel.send('bye');
    channel.close();
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') startPopout();
