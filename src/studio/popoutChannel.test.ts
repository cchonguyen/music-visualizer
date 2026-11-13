// Slice 22.5: the pop-out message contract. These tests run the real validateMessage and the real
// createPopoutChannel. The only fake is the global BroadcastChannel, so the default transport path is exercised.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPopoutChannel,
  POPOUT_CHANNEL_NAME,
  POPOUT_DISCONNECT_TIMEOUT_MS,
  POPOUT_HEARTBEAT_INTERVAL_MS,
  POPOUT_MAX_MESSAGE_BYTES,
  validateMessage,
  type PopoutChannel,
  type PopoutMessage,
} from './popoutChannel';

const ORIGIN = 'https://music.example.test';

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
});

afterEach(() => {
  if (originalBroadcastChannel === undefined) delete globalScope.BroadcastChannel;
  else globalScope.BroadcastChannel = originalBroadcastChannel;
});

function envelope(type: string, fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, from: 'main', origin: ORIGIN, id: 'main-1', type, ...fields, ...extra };
}

const VALID_FIELDS: Record<string, Record<string, unknown>> = {
  hello: {},
  heartbeat: {},
  bye: {},
  snapshot: {
    presets: [{ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' }],
    shownPresetId: 'p1',
    shownPresetJson: '{"layers":[]}',
  },
  'select-preset': { presetId: 'p2' },
  edit: { presetId: 'p1', section: 'layers', layerIndex: 0, control: 'opacity', value: 0.5 },
};

function pair(): { main: PopoutChannel; popout: PopoutChannel; received: PopoutMessage[] } {
  const main = createPopoutChannel({ role: 'main', origin: ORIGIN });
  const popout = createPopoutChannel({ role: 'popout', origin: ORIGIN });
  const received: PopoutMessage[] = [];
  popout.onMessage((message) => received.push(message));
  return { main, popout, received };
}

describe('pop-out channel constants', () => {
  it('uses the dedicated channel name and the agreed timing constants', () => {
    expect(POPOUT_CHANNEL_NAME).toBe('mv-studio-popout');
    expect(POPOUT_CHANNEL_NAME).not.toBe('mv-admin-auth');
    expect(POPOUT_HEARTBEAT_INTERVAL_MS).toBe(2000);
    expect(POPOUT_DISCONNECT_TIMEOUT_MS).toBe(6000);
    expect(POPOUT_MAX_MESSAGE_BYTES).toBe(512 * 1024);
  });
});

describe('validateMessage round trip', () => {
  for (const type of Object.keys(VALID_FIELDS)) {
    it(`accepts a valid '${type}' message`, () => {
      const result = validateMessage(envelope(type, VALID_FIELDS[type] ?? {}), ORIGIN);
      expect(result).not.toBeNull();
      expect(result?.type).toBe(type);
      expect(result?.v).toBe(1);
      expect(result?.from).toBe('main');
      expect(result?.origin).toBe(ORIGIN);
      expect(result?.id).toBe('main-1');
      expect(result).toMatchObject(VALID_FIELDS[type] ?? {});
    });
  }

  it('round-trips a message through the channel pair', () => {
    const { main, received } = pair();
    expect(main.send('select-preset', { presetId: 'p2' })).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: 'select-preset', from: 'main', presetId: 'p2' });
  });
});

describe('validateMessage drops', () => {
  it('drops a wrong protocol version', () => {
    expect(validateMessage(envelope('hello', {}, { v: 2 }), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('hello', {}, { v: '1' }), ORIGIN)).toBeNull();
  });

  it('drops a message from another origin', () => {
    expect(validateMessage(envelope('hello', {}, { origin: 'https://evil.example' }), ORIGIN)).toBeNull();
  });

  it('drops an unknown type and admin-like types', () => {
    expect(validateMessage(envelope('admin-login'), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('write-server', { presetId: 'p1' }), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('__proto__'), ORIGIN)).toBeNull();
  });

  it('drops an unknown role', () => {
    expect(validateMessage(envelope('hello', {}, { from: 'admin' }), ORIGIN)).toBeNull();
  });

  it('drops an oversize message', () => {
    const huge = envelope('snapshot', {
      presets: [],
      shownPresetId: 'p1',
      shownPresetJson: 'x'.repeat(POPOUT_MAX_MESSAGE_BYTES),
    });
    expect(validateMessage(huge, ORIGIN)).toBeNull();
  });

  it('drops a message with prototype-pollution keys, at any depth', () => {
    const top = JSON.parse(
      '{"v":1,"from":"main","origin":"https://music.example.test","id":"a","type":"hello","__proto__":{"isAdmin":true}}',
    ) as unknown;
    expect(validateMessage(top, ORIGIN)).toBeNull();

    const nestedConstructor = envelope('select-preset', { presetId: 'p1', meta: { constructor: { x: 1 } } });
    expect(validateMessage(nestedConstructor, ORIGIN)).toBeNull();

    const nestedPrototype = envelope('select-preset', { presetId: 'p1', meta: [{ prototype: 1 }] });
    expect(validateMessage(nestedPrototype, ORIGIN)).toBeNull();
  });

  it('drops a message nested deeper than the depth limit', () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 12; i += 1) {
      const next: Record<string, unknown> = {};
      cursor.n = next;
      cursor = next;
    }
    expect(validateMessage(envelope('hello', { extra: deep }), ORIGIN)).toBeNull();
  });

  it('drops non-object input without throwing', () => {
    for (const raw of [null, undefined, 'hello', 42, true, [], ['hello']]) {
      expect(() => validateMessage(raw, ORIGIN)).not.toThrow();
      expect(validateMessage(raw, ORIGIN)).toBeNull();
    }
  });

  it('drops an edit with NaN or Infinity', () => {
    const base = VALID_FIELDS.edit ?? {};
    expect(validateMessage(envelope('edit', { ...base, value: Number.NaN }), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('edit', { ...base, value: Number.POSITIVE_INFINITY }), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('edit', { ...base, value: Number.NEGATIVE_INFINITY }), ORIGIN)).toBeNull();
  });

  it('drops an edit with a bad layer index or missing fields', () => {
    const base = VALID_FIELDS.edit ?? {};
    expect(validateMessage(envelope('edit', { ...base, layerIndex: -1 }), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('edit', { ...base, layerIndex: 1.5 }), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('edit', { ...base, control: undefined }), ORIGIN)).toBeNull();
  });

  it('drops a snapshot with a malformed preset list', () => {
    const base = VALID_FIELDS.snapshot ?? {};
    expect(validateMessage(envelope('snapshot', { ...base, presets: 'nope' }), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('snapshot', { ...base, presets: [{ id: 'p1' }] }), ORIGIN)).toBeNull();
  });

  it('drops a message whose id is missing or empty', () => {
    expect(validateMessage(envelope('hello', {}, { id: '' }), ORIGIN)).toBeNull();
    expect(validateMessage(envelope('hello', {}, { id: 7 }), ORIGIN)).toBeNull();
  });
});

describe('validateMessage field handling', () => {
  it('strips extra fields instead of passing them through', () => {
    const base = VALID_FIELDS.edit ?? {};
    const result = validateMessage(
      envelope('edit', { ...base, token: 'secret', admin: true, serverWrite: 'yes' }),
      ORIGIN,
    );
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('admin');
    expect(result).not.toHaveProperty('serverWrite');
    expect(Object.keys(result ?? {}).sort()).toEqual(
      ['control', 'from', 'id', 'layerIndex', 'origin', 'presetId', 'section', 'type', 'v', 'value'].sort(),
    );
  });

  it('keeps boolean and short string edit values', () => {
    const base = VALID_FIELDS.edit ?? {};
    expect(validateMessage(envelope('edit', { ...base, value: true }), ORIGIN)).toMatchObject({ value: true });
    expect(validateMessage(envelope('edit', { ...base, value: 'warm' }), ORIGIN)).toMatchObject({ value: 'warm' });
  });
});

describe('createPopoutChannel', () => {
  it('ignores the own role echo', () => {
    const first = createPopoutChannel({ role: 'main', origin: ORIGIN });
    const second = createPopoutChannel({ role: 'main', origin: ORIGIN });
    const seenBySecond: PopoutMessage[] = [];
    second.onMessage((message) => seenBySecond.push(message));
    first.send('hello');
    expect(seenBySecond).toHaveLength(0);
  });

  it('refuses to send an invalid edit and posts nothing', () => {
    const { main, received } = pair();
    const sent = main.send('edit', {
      presetId: 'p1',
      section: 'layers',
      layerIndex: -1,
      control: 'opacity',
      value: 1,
    });
    expect(sent).toBe(false);
    expect(received).toHaveLength(0);
  });

  it('does not forward caller-supplied envelope fields on send', () => {
    const { main, received } = pair();
    const forged = { v: 2, from: 'popout', origin: 'https://evil.example', presetId: 'p9', token: 'x' } as unknown as {
      presetId: string;
    };
    expect(main.send('select-preset', forged)).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ v: 1, from: 'main', origin: ORIGIN, presetId: 'p9' });
    expect(received[0]).not.toHaveProperty('token');
  });

  it('gives each sent message a distinct id', () => {
    const { main, received } = pair();
    for (let i = 0; i < 50; i += 1) main.send('heartbeat');
    const ids = new Set(received.map((message) => message.id));
    expect(ids.size).toBe(50);
  });

  it('does not propagate handler exceptions and still calls the other handlers', () => {
    const main = createPopoutChannel({ role: 'main', origin: ORIGIN });
    const popout = createPopoutChannel({ role: 'popout', origin: ORIGIN });
    let secondCalled = 0;
    popout.onMessage(() => {
      throw new Error('handler failure');
    });
    popout.onMessage(() => {
      secondCalled += 1;
    });
    expect(() => main.send('bye')).not.toThrow();
    expect(secondCalled).toBe(1);
  });

  it('stops delivering after unsubscribe and after close', () => {
    const { main, popout, received } = pair();
    const extra: PopoutMessage[] = [];
    const unsubscribe = popout.onMessage((message) => extra.push(message));
    unsubscribe();
    main.send('bye');
    expect(extra).toHaveLength(0);
    expect(received).toHaveLength(1);

    popout.close();
    main.send('bye');
    expect(received).toHaveLength(1);
    expect(() => popout.close()).not.toThrow();
  });

  it('reports supported: false and a no-op channel when BroadcastChannel is missing', () => {
    delete globalScope.BroadcastChannel;
    const channel = createPopoutChannel({ role: 'popout', origin: ORIGIN });
    expect(channel.supported).toBe(false);
    expect(channel.send('hello')).toBe(false);
    const unsubscribe = channel.onMessage(() => undefined);
    expect(() => unsubscribe()).not.toThrow();
    expect(() => channel.close()).not.toThrow();
  });

  it('reports supported: false when an injected factory returns null or throws', () => {
    expect(createPopoutChannel({ role: 'main', origin: ORIGIN, channelFactory: () => null }).supported).toBe(false);
    const throwing = createPopoutChannel({
      role: 'main',
      origin: ORIGIN,
      channelFactory: () => {
        throw new Error('no channel');
      },
    });
    expect(throwing.supported).toBe(false);
  });

  it('reports supported: false when the BroadcastChannel constructor throws', () => {
    globalScope.BroadcastChannel = class {
      constructor() {
        throw new Error('blocked');
      }
    };
    expect(createPopoutChannel({ role: 'main', origin: ORIGIN }).supported).toBe(false);
  });

  it('opens the dedicated channel name', () => {
    createPopoutChannel({ role: 'main', origin: ORIGIN });
    expect(FakeBroadcastChannel.instances[0]?.name).toBe('mv-studio-popout');
  });
});

describe('edit messages outside layers (slice 22.7)', () => {
  const base = VALID_FIELDS.edit ?? {};

  it('accepts a null layer index for feedbackPost and warp sections', () => {
    expect(validateMessage(envelope('edit', { ...base, section: 'feedbackPost', layerIndex: null }), ORIGIN)).toMatchObject({
      section: 'feedbackPost',
      layerIndex: null,
    });
    expect(validateMessage(envelope('edit', { ...base, section: 'warp0', layerIndex: null }), ORIGIN)).toMatchObject({
      section: 'warp0',
      layerIndex: null,
    });
  });

  it('still rejects a null layer index on a layer section', () => {
    expect(validateMessage(envelope('edit', { ...base, section: 'layer', layerIndex: null }), ORIGIN)).toBeNull();
  });

  it('still rejects negative, fractional or non-number layer indices', () => {
    for (const layerIndex of [-1, 1.5, Number.NaN, '0', undefined]) {
      expect(validateMessage(envelope('edit', { ...base, section: 'feedbackPost', layerIndex }), ORIGIN)).toBeNull();
    }
  });

  it('rejects a section that is not a short plain name', () => {
    for (const section of ['', 'layer; drop', 'a'.repeat(65), 'warp-1', '__proto__', 42]) {
      expect(validateMessage(envelope('edit', { ...base, section, layerIndex: null }), ORIGIN)).toBeNull();
    }
  });
});
