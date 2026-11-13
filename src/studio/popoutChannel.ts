// Slice 22.5: typed, versioned, same-origin, allowlisted messages for the Studio pop-out window.
// Pure validation plus a thin BroadcastChannel wrapper. This module must not import Tweakpane or studio.ts:
// src/main.ts imports it, and the main bundle must stay free of Studio code.
// The channel is 'mv-studio-popout'. It is not the admin-login channel 'mv-admin-auth'.

export const POPOUT_CHANNEL_NAME = 'mv-studio-popout';
export const POPOUT_PROTOCOL_VERSION = 1;
/** Serialised (UTF-8 JSON) size cap for one message. Larger messages are dropped. */
export const POPOUT_MAX_MESSAGE_BYTES = 512 * 1024;
export const POPOUT_HEARTBEAT_INTERVAL_MS = 2000;
export const POPOUT_DISCONNECT_TIMEOUT_MS = 6000;

const MAX_DEPTH = 8;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 256;
const MAX_SECTION_LENGTH = 64;
const MAX_CONTROL_LENGTH = 64;
const MAX_VALUE_STRING_LENGTH = 256;
const MAX_PRESETS = 500;
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export const POPOUT_ROLES = ['main', 'popout'] as const;
export type PopoutRole = (typeof POPOUT_ROLES)[number];
const ROLE_SET: ReadonlySet<string> = new Set(POPOUT_ROLES);

export const POPOUT_MESSAGE_TYPES = ['hello', 'snapshot', 'select-preset', 'edit', 'heartbeat', 'bye'] as const;
export type PopoutMessageType = (typeof POPOUT_MESSAGE_TYPES)[number];
const TYPE_SET: ReadonlySet<string> = new Set(POPOUT_MESSAGE_TYPES);

export type NoFields = Record<never, never>;
export interface PresetEntry {
  id: string;
  name: string;
}
export interface SnapshotFields {
  presets: PresetEntry[];
  shownPresetId: string;
  shownPresetJson: string;
}
export interface SelectPresetFields {
  presetId: string;
}
export type EditValue = number | boolean | string;
export interface EditFields {
  presetId: string;
  section: string;
  layerIndex: number;
  control: string;
  value: EditValue;
}

export interface PopoutFieldsByType {
  hello: NoFields;
  snapshot: SnapshotFields;
  'select-preset': SelectPresetFields;
  edit: EditFields;
  heartbeat: NoFields;
  bye: NoFields;
}

export interface PopoutEnvelope<T extends PopoutMessageType> {
  v: typeof POPOUT_PROTOCOL_VERSION;
  from: PopoutRole;
  origin: string;
  id: string;
  type: T;
}

export type PopoutMessage = {
  [K in PopoutMessageType]: PopoutEnvelope<K> & PopoutFieldsByType[K];
}[PopoutMessageType];

type Raw = Record<string, unknown>;
type AnyFields = PopoutFieldsByType[PopoutMessageType];

function isPlainObject(value: unknown): value is Raw {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True when a forbidden key appears anywhere in the value, or the nesting is deeper than MAX_DEPTH. */
function hasForbiddenKey(value: unknown, depth: number): boolean {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item: unknown) => hasForbiddenKey(item, depth + 1));
  if (value === null || typeof value !== 'object') return false;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKey((value as Raw)[key], depth + 1)) return true;
  }
  return false;
}

function readString(obj: Raw, key: string, min: number, max: number): string | null {
  const value = obj[key];
  return typeof value === 'string' && value.length >= min && value.length <= max ? value : null;
}

function readLayerIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readEditValue(value: unknown): EditValue | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return value.length <= MAX_VALUE_STRING_LENGTH ? value : null;
  return null;
}

function readPresets(value: unknown): PresetEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_PRESETS) return null;
  const out: PresetEntry[] = [];
  for (const item of value as unknown[]) {
    if (!isPlainObject(item)) return null;
    const id = readString(item, 'id', 1, MAX_ID_LENGTH);
    const name = readString(item, 'name', 0, MAX_NAME_LENGTH);
    if (id === null || name === null) return null;
    out.push({ id, name });
  }
  return out;
}

/** Reads only the fields each type allows. Anything else in the payload is dropped, never copied. */
function readFields(type: PopoutMessageType, raw: Raw): AnyFields | null {
  switch (type) {
    case 'hello':
    case 'heartbeat':
    case 'bye':
      return {};
    case 'select-preset': {
      const presetId = readString(raw, 'presetId', 1, MAX_ID_LENGTH);
      return presetId === null ? null : { presetId };
    }
    case 'snapshot': {
      const presets = readPresets(raw['presets']);
      const shownPresetId = readString(raw, 'shownPresetId', 0, MAX_ID_LENGTH);
      const shownPresetJson = readString(raw, 'shownPresetJson', 1, POPOUT_MAX_MESSAGE_BYTES);
      if (presets === null || shownPresetId === null || shownPresetJson === null) return null;
      return { presets, shownPresetId, shownPresetJson };
    }
    case 'edit': {
      const presetId = readString(raw, 'presetId', 1, MAX_ID_LENGTH);
      const section = readString(raw, 'section', 1, MAX_SECTION_LENGTH);
      const layerIndex = readLayerIndex(raw['layerIndex']);
      const control = readString(raw, 'control', 1, MAX_CONTROL_LENGTH);
      const value = readEditValue(raw['value']);
      if (presetId === null || section === null || layerIndex === null || control === null || value === null) {
        return null;
      }
      return { presetId, section, layerIndex, control, value };
    }
    default:
      return null;
  }
}

/**
 * Returns a typed message built only from the allowed fields, or null when the input must be dropped.
 * Never throws.
 */
export function validateMessage(raw: unknown, ownOrigin: string): PopoutMessage | null {
  try {
    if (!isPlainObject(raw)) return null;
    const json = JSON.stringify(raw);
    if (json === undefined || new TextEncoder().encode(json).byteLength > POPOUT_MAX_MESSAGE_BYTES) return null;
    if (hasForbiddenKey(raw, 0)) return null;
    if (raw['v'] !== POPOUT_PROTOCOL_VERSION) return null;
    const from = raw['from'];
    if (typeof from !== 'string' || !ROLE_SET.has(from)) return null;
    if (ownOrigin === '' || raw['origin'] !== ownOrigin) return null;
    const id = readString(raw, 'id', 1, MAX_ID_LENGTH);
    if (id === null) return null;
    const type = raw['type'];
    if (typeof type !== 'string' || !TYPE_SET.has(type)) return null;
    const fields = readFields(type as PopoutMessageType, raw);
    if (fields === null) return null;
    return {
      v: POPOUT_PROTOCOL_VERSION,
      from: from as PopoutRole,
      origin: ownOrigin,
      id,
      type,
      ...fields,
    } as PopoutMessage;
  } catch {
    return null;
  }
}

/** Minimal channel surface. The default adapter wraps a real BroadcastChannel. Tests inject fakes. */
export interface PopoutTransport {
  postMessage(data: unknown): void;
  close(): void;
  setHandler(handler: (data: unknown) => void): void;
}
/** Returns null when the transport cannot be created (unsupported environment). */
export type PopoutTransportFactory = (name: string) => PopoutTransport | null;

export interface PopoutChannelOptions {
  role: PopoutRole;
  origin: string;
  channelFactory?: PopoutTransportFactory;
}

export interface PopoutChannel {
  readonly supported: boolean;
  /** Validates the outgoing message and posts it. Returns false when nothing was posted. */
  send<K extends PopoutMessageType>(type: K, fields?: PopoutFieldsByType[K]): boolean;
  /** Registers a handler for valid messages from the other role. Returns an unsubscribe function. */
  onMessage(handler: (message: PopoutMessage) => void): () => void;
  close(): void;
}

const defaultTransportFactory: PopoutTransportFactory = (name) => {
  if (typeof BroadcastChannel !== 'function') return null;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(name);
  } catch {
    return null;
  }
  return {
    postMessage: (data) => channel.postMessage(data),
    close: () => channel.close(),
    setHandler: (handler) => {
      channel.onmessage = (event: MessageEvent) => handler(event.data);
    },
  };
};

let messageCounter = 0;
function nextMessageId(role: PopoutRole): string {
  messageCounter = (messageCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${role}-${Date.now().toString(36)}-${messageCounter.toString(36)}`;
}

function openTransport(factory: PopoutTransportFactory): PopoutTransport | null {
  try {
    return factory(POPOUT_CHANNEL_NAME);
  } catch {
    return null;
  }
}

const NOOP_CHANNEL: PopoutChannel = {
  supported: false,
  send: () => false,
  onMessage: () => () => undefined,
  close: () => undefined,
};

export function createPopoutChannel(options: PopoutChannelOptions): PopoutChannel {
  const { role, origin } = options;
  const factory = options.channelFactory ?? defaultTransportFactory;

  const transport = openTransport(factory);
  if (transport === null) return NOOP_CHANNEL;

  const handlers = new Set<(message: PopoutMessage) => void>();
  let closed = false;

  transport.setHandler((data: unknown) => {
    if (closed) return;
    const message = validateMessage(data, origin);
    if (message === null || message.from === role) return;
    for (const handler of [...handlers]) {
      try {
        handler(message);
      } catch {
        // A throwing handler must not stop other handlers or reach the sender.
      }
    }
  });

  return {
    supported: true,
    send(type, fields) {
      if (closed) return false;
      try {
        const raw = { ...(fields ?? {}), v: POPOUT_PROTOCOL_VERSION, from: role, origin, id: nextMessageId(role), type };
        const message = validateMessage(raw, origin);
        if (message === null) return false;
        transport.postMessage(message);
        return true;
      } catch {
        return false;
      }
    },
    onMessage(handler) {
      if (closed) return () => undefined;
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      handlers.clear();
      try {
        transport.close();
      } catch {
        // Closing an already-closed channel is not an error for callers.
      }
    },
  };
}
