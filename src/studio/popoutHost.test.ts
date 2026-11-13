// Slice 22.7: the main-window pop-out host. Runs the real channel and the real session in node.
// The only fakes are the BroadcastChannel (global) and a stub scene for the live-apply path.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_PRESETS, SCHEMAS } from '../presets/builtin';
import { PresetSession, type SceneHost } from '../presets/session';
import { LAYER_SPECS } from '../presets/layerSchemas';
import type { Scene } from '../render/scene';
import { warpOpSpecs } from '../presets/warpOps';
import { POPOUT_DISCONNECT_TIMEOUT_MS, POPOUT_HEARTBEAT_INTERVAL_MS, createPopoutChannel, type EditValue, type PopoutMessage } from './popoutChannel';
import { applyEdit, createPopoutHost, type PopoutHost } from './popoutHost';

const ORIGIN = 'https://music.example.test';

/** A float or int spec, with the bounds the clamp tests read. */
type NumSpec = { name: string; type: string; min: number; max: number; default: number };

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  readonly name: string;
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    const copy = structuredClone(data);
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer !== this && peer.name === this.name && !peer.closed) peer.onmessage?.({ data: copy });
    }
  }

  close(): void {
    this.closed = true;
  }
}

const globalScope = globalThis as unknown as { BroadcastChannel?: unknown };
let originalBroadcastChannel: unknown;

beforeEach(() => {
  originalBroadcastChannel = globalScope.BroadcastChannel;
  FakeBroadcastChannel.instances = [];
  globalScope.BroadcastChannel = FakeBroadcastChannel;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  if (originalBroadcastChannel === undefined) delete globalScope.BroadcastChannel;
  else globalScope.BroadcastChannel = originalBroadcastChannel;
});

const noopHost: SceneHost = {
  setScene: () => undefined,
  removeScene: () => undefined,
  setFadeSeconds: () => undefined,
  setWeights: () => undefined,
  setPost: () => undefined,
  setTransition: () => undefined,
};

function makeSession(): PresetSession {
  const session = new PresetSession(noopHost, SCHEMAS, undefined);
  for (const b of BUILTIN_PRESETS) session.addBuiltin(b.id, b.preset);
  return session;
}

/** A pop-out side channel. It records what the main window sends. */
function popoutSide(): { send: ReturnType<typeof createPopoutChannel>['send']; received: PopoutMessage[] } {
  const popout = createPopoutChannel({ role: 'popout', origin: ORIGIN });
  const received: PopoutMessage[] = [];
  popout.onMessage((message) => received.push(message));
  return { send: popout.send.bind(popout), received };
}

function fakeScene(): { scene: Scene; setFeedback: ReturnType<typeof vi.fn>; setWarpOps: ReturnType<typeof vi.fn> } {
  const setFeedback = vi.fn();
  const setWarpOps = vi.fn();
  return { scene: { layers: [], setFeedback, setWarpOps } as unknown as Scene, setFeedback, setWarpOps };
}

interface Harness {
  session: PresetSession;
  host: PopoutHost;
  shown: { id: string | null };
  switchTo: ReturnType<typeof vi.fn>;
  connection: boolean[];
  live: ReturnType<typeof fakeScene>;
  popout: ReturnType<typeof popoutSide>;
  saveSpies: Array<ReturnType<typeof vi.spyOn>>;
}

function harness(initialShown = 'crown'): Harness {
  const session = makeSession();
  const shown = { id: initialShown as string | null };
  const switchTo = vi.fn((id: string) => {
    shown.id = id;
  });
  const connection: boolean[] = [];
  const live = fakeScene();
  const host = createPopoutHost({
    session,
    switchTo,
    getShownId: () => shown.id,
    onConnectionChange: (on) => connection.push(on),
    origin: ORIGIN,
    liveScene: () => live.scene,
  });
  // Spies on every save, promote, remove and remote path. None may be called by the pop-out host.
  const saveSpies = [
    vi.spyOn(session, 'save'),
    vi.spyOn(session, 'saveSystemPreset'),
    vi.spyOn(session, 'removeSystemPreset'),
    vi.spyOn(session, 'promoteToSystemPreset'),
    vi.spyOn(session, 'remove'),
    vi.spyOn(session, 'setRemoteWriter'),
    vi.spyOn(session, 'setAdminGateway'),
  ];
  return { session, host, shown, switchTo, connection, live, popout: popoutSide(), saveSpies };
}

function snapshots(received: PopoutMessage[]): Array<Extract<PopoutMessage, { type: 'snapshot' }>> {
  return received.filter((m): m is Extract<PopoutMessage, { type: 'snapshot' }> => m.type === 'snapshot');
}

describe('snapshot', () => {
  it('sends a snapshot on hello with the preset list, shown id and shown JSON', () => {
    const h = harness('crown');
    h.popout.send('hello');
    const [snap] = snapshots(h.popout.received);
    expect(snap).toBeDefined();
    expect(snap!.shownPresetId).toBe('crown');
    expect(snap!.presets.map((p) => p.id)).toContain('crown');
    expect(JSON.parse(snap!.shownPresetJson)).toMatchObject({ name: h.session.get('crown')!.preset.name });
    expect(h.connection).toEqual([true]);
  });

  it('sends a fresh snapshot on every hello (pop-out reload or reopen)', () => {
    const h = harness('crown');
    h.popout.send('hello');
    h.popout.send('hello');
    expect(snapshots(h.popout.received)).toHaveLength(2);
    expect(h.connection).toEqual([true]);
  });

  it('sends a new snapshot when the shown preset changes, and only while connected', () => {
    const h = harness('crown');
    h.host.notifyShownChanged();
    expect(snapshots(h.popout.received)).toHaveLength(0);
    h.popout.send('hello');
    h.shown.id = 'flight';
    h.host.notifyShownChanged();
    const last = snapshots(h.popout.received).at(-1);
    expect(last?.shownPresetId).toBe('flight');
  });
});

describe('select-preset', () => {
  it('switches only to ids that exist in the session', () => {
    const h = harness('crown');
    h.popout.send('select-preset', { presetId: 'flight' });
    expect(h.switchTo).toHaveBeenCalledWith('flight');
    h.popout.send('select-preset', { presetId: 'no-such-preset' });
    expect(h.switchTo).toHaveBeenCalledTimes(1);
  });
});

describe('applyEdit', () => {
  it('applies a layer edit and clamps the value to the spec range', () => {
    const session = makeSession();
    const layerIndex = session.get('crown')!.preset.layers.findIndex((l) => (LAYER_SPECS[l.type] ?? []).some((s) => s.type === 'float'));
    expect(layerIndex).toBeGreaterThanOrEqual(0);
    const layer = session.get('crown')!.preset.layers[layerIndex]!;
    const spec = (LAYER_SPECS[layer.type] ?? []).find((s) => s.type === 'float') as unknown as NumSpec;
    expect(applyEdit(session, { presetId: 'crown', section: 'layer', layerIndex, control: spec.name, value: spec.max + 999 })).toBe(true);
    expect(layer.params[spec.name]!.value).toBe(spec.max);
  });

  it('applies feedbackPost edits and routes Post controls to the post group', () => {
    const session = makeSession();
    const live = fakeScene();
    const feedbackSpec = SCHEMAS.feedback[0]!;
    const postSpec = SCHEMAS.post.find((s) => s.type === 'float') as unknown as NumSpec;
    expect(applyEdit(session, { presetId: 'crown', section: 'feedbackPost', layerIndex: null, control: feedbackSpec.name, value: feedbackSpec.default as EditValue }, () => live.scene)).toBe(true);
    expect(applyEdit(session, { presetId: 'crown', section: 'feedbackPost', layerIndex: null, control: postSpec.name, value: postSpec.default as EditValue }, () => live.scene)).toBe(true);
    const preset = session.get('crown')!.preset;
    expect(preset.post[postSpec.name]).toBeDefined();
    expect(preset.feedback[feedbackSpec.name]).toBeDefined();
  });

  it('applies warp edits to the chosen operator and clamps the value', () => {
    const session = makeSession();
    const preset = session.get('crown')!.preset;
    preset.warp = [{ type: 'swirl', enabled: true, params: {} }];
    const spec = warpOpSpecs('swirl').find((s) => s.type === 'float') as unknown as NumSpec;
    expect(applyEdit(session, { presetId: 'crown', section: 'warp0', layerIndex: null, control: spec.name, value: (spec.max ?? 1) + 999 })).toBe(true);
    expect(preset.warp[0]!.params[spec.name]!.value).toBe(spec.max);
  });

  it('ignores an unknown control name, an unknown layer index and an unknown section', () => {
    const session = makeSession();
    expect(applyEdit(session, { presetId: 'crown', section: 'layer', layerIndex: 0, control: 'notAControl', value: 1 })).toBe(false);
    expect(applyEdit(session, { presetId: 'crown', section: 'layer', layerIndex: 999, control: 'x', value: 1 })).toBe(false);
    expect(applyEdit(session, { presetId: 'crown', section: 'feedbackPost', layerIndex: null, control: 'notAControl', value: 1 })).toBe(false);
    expect(applyEdit(session, { presetId: 'crown', section: 'warp9', layerIndex: null, control: 'x', value: 1 })).toBe(false);
    expect(applyEdit(session, { presetId: 'crown', section: 'other', layerIndex: null, control: 'x', value: 1 })).toBe(false);
    expect(applyEdit(session, { presetId: 'no-such', section: 'feedbackPost', layerIndex: null, control: 'x', value: 1 })).toBe(false);
  });
});

describe('edits through the channel', () => {
  it('applies a valid feedbackPost edit from the pop-out and ignores an unknown control', () => {
    const h = harness('crown');
    const feedbackSpec = SCHEMAS.feedback[0]!;
    h.popout.send('edit', { presetId: 'crown', section: 'feedbackPost', layerIndex: null, control: feedbackSpec.name, value: feedbackSpec.default as EditValue });
    h.popout.send('edit', { presetId: 'crown', section: 'feedbackPost', layerIndex: null, control: 'notAControl', value: 1 });
    expect(h.session.get('crown')!.preset.feedback[feedbackSpec.name]).toBeDefined();
  });
});

describe('heartbeat and connection', () => {
  it('sends a heartbeat on every interval', () => {
    const h = harness('crown');
    vi.advanceTimersByTime(POPOUT_HEARTBEAT_INTERVAL_MS * 3);
    expect(h.popout.received.filter((m) => m.type === 'heartbeat')).toHaveLength(3);
  });

  it('disconnects after the silence timeout and reconnects on the next message', () => {
    const h = harness('crown');
    h.popout.send('hello');
    expect(h.host.isConnected()).toBe(true);
    // The pop-out goes silent. Heartbeats from the host do not count as the pop-out speaking.
    vi.advanceTimersByTime(POPOUT_DISCONNECT_TIMEOUT_MS + POPOUT_HEARTBEAT_INTERVAL_MS);
    expect(h.host.isConnected()).toBe(false);
    expect(h.connection).toEqual([true, false]);
    h.popout.send('heartbeat');
    expect(h.host.isConnected()).toBe(true);
    expect(h.connection).toEqual([true, false, true]);
    expect(snapshots(h.popout.received).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the connection while the pop-out keeps heartbeating', () => {
    const h = harness('crown');
    h.popout.send('hello');
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(POPOUT_HEARTBEAT_INTERVAL_MS);
      h.popout.send('heartbeat');
    }
    expect(h.host.isConnected()).toBe(true);
    expect(h.connection).toEqual([true]);
  });

  it('disconnects at once on bye', () => {
    const h = harness('crown');
    h.popout.send('hello');
    h.popout.send('bye');
    expect(h.host.isConnected()).toBe(false);
    expect(h.connection).toEqual([true, false]);
  });
});

describe('no save, promote, remove or remote writer', () => {
  it('never calls a save, promote, remove or remote function, whatever the pop-out sends', () => {
    const h = harness('crown');
    const feedbackSpec = SCHEMAS.feedback[0]!;
    h.popout.send('hello');
    h.popout.send('select-preset', { presetId: 'flight' });
    h.popout.send('edit', { presetId: 'crown', section: 'feedbackPost', layerIndex: null, control: feedbackSpec.name, value: feedbackSpec.default as EditValue });
    h.popout.send('bye');
    for (const spy of h.saveSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('preset list changes', () => {
  /** Adds a preset to the session list through the builtin path (no save spy is involved). */
  function addPreset(session: PresetSession, id: string): void {
    const preset = structuredClone(BUILTIN_PRESETS[0]!.preset);
    preset.name = `Extra ${id}`;
    session.addBuiltin(id, preset);
  }

  it('sends exactly one new snapshot when the list changes while connected', () => {
    const h = harness('crown');
    h.popout.send('hello');
    const before = snapshots(h.popout.received).length;
    addPreset(h.session, 'extra-test');
    h.popout.send('heartbeat');
    vi.advanceTimersByTime(POPOUT_HEARTBEAT_INTERVAL_MS);
    const all = snapshots(h.popout.received);
    expect(all).toHaveLength(before + 1);
    expect(all.at(-1)!.presets.map((p) => p.id)).toContain('extra-test');
    // Unchanged list on the next tick: no further snapshot.
    h.popout.send('heartbeat');
    vi.advanceTimersByTime(POPOUT_HEARTBEAT_INTERVAL_MS);
    expect(snapshots(h.popout.received)).toHaveLength(before + 1);
  });

  it('sends no snapshot from the timer when the list is unchanged', () => {
    const h = harness('crown');
    h.popout.send('hello');
    for (let i = 0; i < 3; i++) {
      h.popout.send('heartbeat');
      vi.advanceTimersByTime(POPOUT_HEARTBEAT_INTERVAL_MS);
    }
    expect(snapshots(h.popout.received)).toHaveLength(1);
  });

  it('sends nothing when the list changes while not connected', () => {
    const h = harness('crown');
    addPreset(h.session, 'extra-test');
    vi.advanceTimersByTime(POPOUT_HEARTBEAT_INTERVAL_MS * 2);
    expect(snapshots(h.popout.received)).toHaveLength(0);
    expect(h.connection).toEqual([]);
  });

  it('carries the changed list in the hello snapshot after a reconnect', () => {
    const h = harness('crown');
    h.popout.send('hello');
    h.popout.send('bye');
    addPreset(h.session, 'extra-test');
    vi.advanceTimersByTime(POPOUT_HEARTBEAT_INTERVAL_MS * 2);
    const countBeforeHello = snapshots(h.popout.received).length;
    h.popout.send('hello');
    const all = snapshots(h.popout.received);
    expect(all).toHaveLength(countBeforeHello + 1);
    expect(all.at(-1)!.presets.map((p) => p.id)).toContain('extra-test');
  });
});

describe('close', () => {
  it('sends bye, stops the heartbeat and closes the channel', () => {
    const h = harness('crown');
    const heartbeatsBefore = h.popout.received.filter((m) => m.type === 'heartbeat').length;
    h.host.close();
    vi.advanceTimersByTime(POPOUT_HEARTBEAT_INTERVAL_MS * 3);
    const after = h.popout.received.filter((m) => m.type === 'heartbeat').length;
    expect(after).toBe(heartbeatsBefore);
    expect(h.popout.received.some((m) => m.type === 'bye')).toBe(true);
  });
});
