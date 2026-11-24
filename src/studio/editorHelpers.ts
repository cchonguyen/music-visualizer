// Pure helpers behind the Studio editors: layer titles, warp operators, reactions and music-link targets.
import { WARP_OP_LABELS, WARP_OP_TYPES, warpOpSpecs, type WarpOpType } from '../presets/warpOps';
import { LAYER_SPECS } from '../presets/layerSchemas';
import { SCHEMAS, formatLayerType } from '../presets/builtin';
import { type LayerEntry, type Preset, type Settings, type Setting, type WarpOperator } from '../presets/format';
import { isSpecVisible, type ParamSpec } from '../presets/schema';
import { REACTION_EVERY_BEATS_MAX, REACTION_EVERY_SECONDS_MAX, REACTION_EVERY_SECONDS_MIN, type Reaction, type ReactionGroup, type TriggerType } from '../presets/reactions';
import { REACTION_STYLES, REACTION_STYLE_LABELS } from '../presets/reactionStyles';
import { TRIGGER_LABELS, RESPONSE_LABELS } from './labels';

/** Descriptive title for layer settings sections (e.g. "1. Shape (circle · bars)", "2. Spectral Terrain"). */
export function formatLayerTitle(layer: LayerEntry, index: number): string {
  if (layer.type === 'shape') {
    const p = layer.params ?? {};
    const base = (p.baseShape !== null && typeof p.baseShape === 'object' && 'value' in p.baseShape)
      ? p.baseShape.value
      : (p.baseShape ?? 'circle');
    const effect = (p.effectType !== null && typeof p.effectType === 'object' && 'value' in p.effectType)
      ? p.effectType.value
      : (p.effectType ?? 'bars');
    return `${index + 1}. Shape (${base} · ${effect})`;
  }
  return `${index + 1}. ${formatLayerType(layer.type)}`;
}

/** Layer dropdown label in Studio (e.g. "1. Shape (circle · bars)" or "2. Spectral Terrain (off)"). */
export function formatLayerLabel(layer: LayerEntry, index: number): string {
  const off = layer.enabled ? '' : ' (off)';
  return `${formatLayerTitle(layer, index)}${off}`;
}

// --- Warp field (Slice 18.4) -------------------------------------------------------------

/** Operator type choices, labelled for people. */
export function warpTypeOptions(): Record<string, string> {
  return Object.fromEntries(WARP_OP_TYPES.map((t) => [WARP_OP_LABELS[t], t]));
}

/** A new operator with every setting at its default, switched on. */
export function newWarpOperator(type: WarpOpType): WarpOperator {
  const params: Settings = {};
  for (const spec of warpOpSpecs(type)) params[spec.name] = { value: spec.default };
  return { type, enabled: true, params };
}

/** After an operator's type changes: adds the settings the new type has and the old one did not (for example Curl noise's flow style). */
export function fillWarpParams(op: WarpOperator): void {
  for (const spec of warpOpSpecs(op.type)) {
    if (!(spec.name in op.params)) op.params[spec.name] = { value: spec.default };
  }
}

/** One line for the operator list, for example "2. Swirl (off)". */
export function describeWarpOperator(op: WarpOperator, index: number): string {
  return `${index + 1}. ${WARP_OP_LABELS[op.type]}${op.enabled ? '' : ' (off)'}`;
}

// --- Reactions (Slice 17.6) --------------------------------------------------------------

/** The style box value that means "no style of its own; follow the global setting". */
export const REACTION_STYLE_GLOBAL = 'global';

/** Style choices for one preset: follow the global setting, or one of the four styles. */
export function reactionStyleOptions(): Record<string, string> {
  const out: Record<string, string> = { 'Use the global setting': REACTION_STYLE_GLOBAL };
  for (const style of REACTION_STYLES) out[REACTION_STYLE_LABELS[style]] = style;
  return out;
}

export interface ReactionTargetChoice {
  key: string;
  label: string;
  group: ReactionGroup;
  name: string;
}

/** `feedback.zoom` style key for a target. */
export function reactionTargetKey(target: { group: ReactionGroup; name: string }): string {
  return `${target.group}.${target.name}`;
}

export function parseReactionTargetKey(key: string): { group: ReactionGroup; name: string } | null {
  const dot = key.indexOf('.');
  if (dot < 0) return null;
  const group = key.slice(0, dot);
  const name = key.slice(dot + 1);
  return (group === 'feedback' || group === 'post') && name ? { group, name } : null;
}

/** Feedback and Post number controls a reaction can move, skipping ones hidden by the current mode. */
export function reactionTargets(preset: Preset): ReactionTargetChoice[] {
  const out: ReactionTargetChoice[] = [];
  for (const spec of FEEDBACK_NUMBERS) {
    if (isSpecVisible(spec, preset.feedback)) out.push({ key: `feedback.${spec.name}`, label: `Feedback · ${spec.label}`, group: 'feedback', name: spec.name });
  }
  for (const spec of POST_NUMBERS) {
    if (isSpecVisible(spec, preset.post)) out.push({ key: `post.${spec.name}`, label: `Post · ${spec.label}`, group: 'post', name: spec.name });
  }
  return out;
}

/** A starting reaction: a kick on every beat. Defaults to the Feedback zoom. */
export function newReaction(target?: { group: ReactionGroup; name: string }): Reaction {
  return {
    trigger: { type: 'beat' },
    response: 'kick',
    target: target ? { group: target.group, name: target.name } : { group: 'feedback', name: 'zoom' },
    amount: 0.1,
    ease: 0.35,
  };
}

/** A trigger of the given type, with a sensible N when the type needs one. */
export function triggerOf(type: TriggerType, previousN?: number): Reaction['trigger'] {
  if (type === 'everyNBeats') return { type, n: Math.min(REACTION_EVERY_BEATS_MAX, Math.max(1, Math.round(previousN ?? 4))) };
  if (type === 'everyNSeconds') return { type, n: Math.min(REACTION_EVERY_SECONDS_MAX, Math.max(REACTION_EVERY_SECONDS_MIN, previousN ?? 4)) };
  return { type };
}

/** One line for the reaction list, for example "Every 8 beats: Flip, Feedback · Spin per frame (rad)". */
export function describeReaction(r: Reaction): string {
  const n = r.trigger.n;
  const when = r.trigger.type === 'everyNBeats' ? `Every ${n ?? 4} beats` : r.trigger.type === 'everyNSeconds' ? `Every ${n ?? 4} s` : TRIGGER_LABELS[r.trigger.type];
  const specs = r.target.group === 'post' ? POST_NUMBERS : FEEDBACK_NUMBERS;
  const label = specs.find((sp) => sp.name === r.target.name)?.label ?? r.target.name;
  const what = RESPONSE_LABELS[r.response].split(' (')[0];
  return `${when}: ${what}, ${r.target.group === 'post' ? 'Post' : 'Feedback'} · ${label}`;
}

export function formatLinkTargetLabel(baseLabel: string, setting: Setting): string {
  const hasLink = setting.link !== undefined;
  const hasMorph = setting.morph !== undefined;
  if (hasLink && hasMorph) return `[Linked & Morphed] ${baseLabel}`;
  if (hasLink) return `[Linked] ${baseLabel}`;
  if (hasMorph) return `[Morphed] ${baseLabel}`;
  return baseLabel;
}

/** Every numeric setting that can take a link, with the key used in the Studio and the link meter key. */
export function linkTargets(preset: Preset): { key: string; label: string; setting: Setting; meterKey: string; spec: ParamSpec }[] {
  const out: { key: string; label: string; setting: Setting; meterKey: string; spec: ParamSpec }[] = [];
  let live = 0;
  preset.layers.forEach((layer, i) => {
    const k = layer.enabled ? live++ : -1;
    const layerTitle = formatLayerTitle(layer, i);
    for (const spec of LAYER_SPECS[layer.type] ?? []) {
      if (spec.type !== 'float' && spec.type !== 'int') continue;
      if (!isSpecVisible(spec, layer.params)) continue;
      const setting = layer.params[spec.name];
      if (!setting) continue;
      out.push({
        key: `L${i}.${spec.name}`,
        label: formatLinkTargetLabel(`${layerTitle} · ${spec.label}`, setting),
        setting,
        meterKey: k >= 0 ? `L${k}.${spec.name}` : '',
        spec,
      });
    }
  });
  (preset.warp ?? []).forEach((op, i) => {
    for (const spec of warpOpSpecs(op.type)) {
      if (spec.type !== 'float' && spec.type !== 'int') continue;
      const setting = op.params[spec.name];
      if (!setting) continue;
      out.push({
        key: `W${i}.${spec.name}`,
        label: formatLinkTargetLabel(`Warp ${i + 1}. ${WARP_OP_LABELS[op.type]} · ${spec.label}`, setting),
        setting,
        meterKey: `W${i}.${spec.name}`,
        spec,
      });
    }
  });
  for (const spec of FEEDBACK_NUMBERS) {
    if (!isSpecVisible(spec, preset.feedback)) continue;
    const setting = preset.feedback[spec.name];
    if (setting) out.push({ key: `F.${spec.name}`, label: formatLinkTargetLabel(`Feedback · ${spec.label}`, setting), setting, meterKey: `F.${spec.name}`, spec });
  }
  for (const spec of POST_NUMBERS) {
    if (!isSpecVisible(spec, preset.post)) continue;
    const setting = preset.post[spec.name];
    if (setting) out.push({ key: `P.${spec.name}`, label: formatLinkTargetLabel(`Post · ${spec.label}`, setting), setting, meterKey: `P.${spec.name}`, spec });
  }
  return out;
}

export const FEEDBACK_NUMBERS = SCHEMAS.feedback.filter((s) => s.type === 'float' || s.type === 'int');

export const POST_NUMBERS = SCHEMAS.post.filter((s) => s.type === 'float' || s.type === 'int');
