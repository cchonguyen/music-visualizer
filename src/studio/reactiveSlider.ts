import {
  AUDIO_SOURCES,
  LFO_RATE_DEFAULT,
  LFO_RATE_MAX,
  LFO_RATE_MIN,
  LINK_COOLDOWN_DEFAULT,
  LINK_COOLDOWN_MAX,
  LINK_COOLDOWN_MIN,
  LINK_CURVES,
  LINK_FLIP_SLEW_DEFAULT,
  LINK_FLIP_SLEW_MAX,
  LINK_FLIP_SLEW_MIN,
  LINK_MODES,
  LINK_THRESHOLD_DEFAULT,
  LINK_THRESHOLD_MAX,
  LINK_THRESHOLD_MIN,
  MORPH_RATE_DEFAULT,
  MORPH_RATE_MAX,
  MORPH_RATE_MIN,
  type AudioLink,
  type AudioSource,
  type LinkCurve,
  type LinkMode,
  type Setting,
} from '../presets/format';
import {
  LINK_RECIPES,
  buildRecipeLink,
  matchingRecipeId,
  summarizeAudioLink,
} from '../presets/linkRecipes';
import { neutralPointForSpec } from '../presets/links';
import type { ColourSpec, EnumSpec, NumberSpec, ParamValue } from '../presets/schema';

export type ReactiveParamSpec = NumberSpec | EnumSpec | ColourSpec;

export interface ReactiveSliderHandle {
  meterKey: string;
  openDrawer: () => void;
  closeDrawer: () => void;
  syncVisual: () => void;
  updateLiveOverlay: (resolvedValue: number | undefined, calm: boolean) => void;
  dispose: () => void;
}

export interface AttachReactiveSliderOptions {
  blade: any;
  spec: ReactiveParamSpec;
  setting: Setting;
  meterKey: string;
  onMutate: (discrete: boolean) => void;
  onDrawerToggle?: (handle: ReactiveSliderHandle | null) => void;
  allowMorph?: boolean;
  onClear?: () => void;
}

const ENUM_TRIGGER_SOURCES = [
  'section',
  'drop',
  'breakdown',
  'phrase16',
  'phrase32',
  'beat',
  'kickEnv',
  'onset',
  'energy',
  'bass',
  'mid',
  'high',
] as const;

const ENUM_TRIGGER_CHIPS: ReadonlyArray<{ id: string; label: string; link: AudioLink }> = [
  { id: 'section8', label: 'Section 8s', link: { source: 'section', amount: 1, smooth: 0, cooldownSec: 8 } },
  { id: 'drop10', label: 'Drop 10s', link: { source: 'drop', amount: 1, smooth: 0, cooldownSec: 10 } },
  { id: 'phrase16b', label: 'Phrase 16b', link: { source: 'phrase16', amount: 1, smooth: 0, cooldownSec: 4 } },
  { id: 'phrase32b', label: 'Phrase 32b', link: { source: 'phrase32', amount: 1, smooth: 0, cooldownSec: 8 } },
  { id: 'beat4', label: 'Beat 4s', link: { source: 'beat', amount: 1, smooth: 0, cooldownSec: 4 } },
];

const COLOUR_RECIPES: ReadonlyArray<{ id: string; label: string; link: AudioLink }> = [
  {
    id: 'phraseHueDrift',
    label: 'Phrase Hue Drift',
    link: { source: 'phrase32', mode: 'bipolar', curve: 'linear', amount: 0.5, smooth: 0.55 },
  },
  {
    id: 'bassHuePulse',
    label: 'Bass Hue Pulse',
    link: { source: 'bass', mode: 'add', curve: 'swell', amount: 0.35, smooth: 0.25 },
  },
  {
    id: 'dropHueShift',
    label: 'Drop Hue Shift',
    link: { source: 'drop', mode: 'add', curve: 'gate', amount: 0.5, smooth: 0.2, threshold: 0.25 },
  },
  {
    id: 'energyRainbow',
    label: 'Energy Rainbow',
    link: { source: 'energy', mode: 'add', curve: 'linear', amount: 0.65, smooth: 0.4 },
  },
];

function clearSettingProp(obj: any, prop: 'link' | 'morph'): void {
  const desc = Object.getOwnPropertyDescriptor(obj, prop);
  if (desc?.set) {
    obj[prop] = undefined;
  } else {
    delete obj[prop];
  }
}

function matchingColourRecipeId(link?: AudioLink): string | null {
  if (!link) return null;
  const mode = link.mode ?? 'add';
  const curve = link.curve ?? 'linear';
  const match = COLOUR_RECIPES.find(
    (r) =>
      r.link.source === link.source &&
      (r.link.mode ?? 'add') === mode &&
      (r.link.curve ?? 'linear') === curve,
  );
  return match ? match.id : null;
}

function setClass(node: any, cls: string, on: boolean): void {
  if (!node?.classList) return;
  if (on) node.classList.add(cls);
  else node.classList.remove(cls);
}

function setStyle(node: any, prop: string, value: string): void {
  if (node?.style) {
    node.style[prop] = value;
  }
}

function removeEl(node: any): void {
  if (!node) return;
  if (typeof node.remove === 'function') {
    node.remove();
  } else if (node.parentElement && typeof node.parentElement.removeChild === 'function') {
    node.parentElement.removeChild(node);
  } else if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
    node.parentNode.removeChild(node);
  }
}

function insertAfter(anchor: any, node: any): void {
  if (!anchor || !node) return;
  if (typeof anchor.after === 'function') {
    anchor.after(node);
    return;
  }
  const parent = anchor.parentElement ?? anchor.parentNode;
  if (!parent) return;
  if (typeof parent.insertBefore === 'function') {
    parent.insertBefore(node, anchor.nextSibling ?? null);
  } else if (typeof parent.appendChild === 'function') {
    parent.appendChild(node);
  } else if (typeof parent.append === 'function') {
    parent.append(node);
  }
}

function defaultMorphTarget(spec: NumberSpec, value: ParamValue): number {
  const base = typeof value === 'number' ? value : spec.default;
  const quarter = (spec.max - spec.min) * 0.25;
  let to = base + quarter;
  if (to > spec.max) to = base - quarter;
  to = Math.min(spec.max, Math.max(spec.min, to));
  return spec.type === 'int' ? Math.round(to) : Number(to.toFixed(4));
}

function formatNumber(v: number, step: number): string {
  if (step >= 1 && Number.isInteger(step)) return String(Math.round(v));
  if (step >= 0.1) return v.toFixed(1);
  return v.toFixed(2);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

const NOOP_HANDLE: ReactiveSliderHandle = {
  meterKey: '',
  openDrawer: () => {},
  closeDrawer: () => {},
  syncVisual: () => {},
  updateLiveOverlay: () => {},
  dispose: () => {},
};

/**
 * Attaches an inline `⚡` reactivity badge, live track modulation overlay (numeric),
 * and collapsible inline drawer to a numeric, enum, or colour Tweakpane blade.
 */
export function attachReactiveSlider(opts: AttachReactiveSliderOptions): ReactiveSliderHandle {
  const { blade, spec, setting, meterKey, onMutate, onDrawerToggle, onClear } = opts;
  const isNumeric = spec.type === 'float' || spec.type === 'int';
  const isEnum = spec.type === 'enum';
  const isColour = spec.type === 'colour';
  if (!blade || typeof blade !== 'object' || (!isNumeric && !isEnum && !isColour)) {
    return NOOP_HANDLE;
  }

  const allowMorph = opts.allowMorph ?? isNumeric;

  const el: HTMLElement | undefined = blade.element;
  if (!el) return { ...NOOP_HANDLE, meterKey };

  const doc: Document | null =
    (el as any).ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return { ...NOOP_HANDLE, meterKey };

  // 1. Inject ⚡ button into .tp-lblv_l (or fallback onto blade.element)
  const labelEl = typeof el.querySelector === 'function' ? el.querySelector('.tp-lblv_l') : null;
  const boltHost: any = labelEl ?? el;
  const boltBtn = doc.createElement('button');
  boltBtn.type = 'button';
  boltBtn.className = 'mv-react-bolt';
  boltBtn.textContent = '⚡';
  boltBtn.setAttribute?.('aria-label', `${spec.label} reactivity`);
  boltBtn.setAttribute?.('aria-expanded', 'false');
  if (typeof boltHost.append === 'function') {
    boltHost.append(boltBtn);
  } else if (typeof boltHost.appendChild === 'function') {
    boltHost.appendChild(boltBtn);
  }

  // 2. Inject live modulation band + resolved value dot inside .tp-sldv_t (numeric real DOM)
  const trackEl = isNumeric && typeof el.querySelector === 'function' ? el.querySelector('.tp-sldv_t') : null;
  let bandEl: HTMLElement | null = null;
  let dotEl: HTMLElement | null = null;
  if (trackEl) {
    bandEl = doc.createElement('div');
    bandEl.className = 'mv-react-band';
    setStyle(bandEl, 'display', 'none');

    dotEl = doc.createElement('div');
    dotEl.className = 'mv-react-dot';
    setStyle(dotEl, 'display', 'none');

    if (typeof (trackEl as any).append === 'function') {
      (trackEl as any).append(bandEl, dotEl);
    } else if (typeof trackEl.appendChild === 'function') {
      trackEl.appendChild(bandEl);
      trackEl.appendChild(dotEl);
    }
  }

  // 3. Drawer state & lazy UI refs
  let isOpen = false;
  let disposed = false;
  let drawerEl: HTMLElement | null = null;
  let chipButtons: Array<{ id: string; btn: HTMLButtonElement; enumLink?: AudioLink }> = [];
  let sourceSelect: HTMLSelectElement | null = null;
  let modeSelect: HTMLSelectElement | null = null;
  let curveSelect: HTMLSelectElement | null = null;
  let amountInput: HTMLInputElement | null = null;
  let amountVal: HTMLElement | null = null;
  let smoothInput: HTMLInputElement | null = null;
  let smoothVal: HTMLElement | null = null;
  let gateRow: HTMLElement | null = null;
  let gateInput: HTMLInputElement | null = null;
  let gateVal: HTMLElement | null = null;
  let slewRow: HTMLElement | null = null;
  let slewInput: HTMLInputElement | null = null;
  let slewVal: HTMLElement | null = null;
  let rateRow: HTMLElement | null = null;
  let rateInput: HTMLInputElement | null = null;
  let rateVal: HTMLElement | null = null;
  let morphToggle: HTMLInputElement | null = null;
  let morphFields: HTMLElement | null = null;
  let morphToInput: HTMLInputElement | null = null;
  let morphToVal: HTMLElement | null = null;
  let morphRateInput: HTMLInputElement | null = null;
  let morphRateVal: HTMLElement | null = null;

  // Enum-specific UI refs
  let enumTriggerSelect: HTMLSelectElement | null = null;
  let enumCooldownInput: HTMLInputElement | null = null;
  let enumCooldownVal: HTMLElement | null = null;
  let enumOptButtons: Array<{ opt: string; btn: HTMLButtonElement }> = [];

  const ensureLink = (): AudioLink => {
    if (!setting.link) {
      if (isEnum) {
        setting.link = {
          source: 'section',
          amount: 1,
          smooth: 0,
          cooldownSec: LINK_COOLDOWN_DEFAULT,
        };
      } else if (isColour) {
        setting.link = { source: 'phrase32', amount: 0.5, smooth: 0.55, mode: 'bipolar', curve: 'linear' };
      } else {
        setting.link = { source: 'bass', amount: 0.25, smooth: 0.2 };
      }
    }
    return setting.link;
  };

  const setRowVisible = (row: HTMLElement | null, visible: boolean) => {
    if (!row) return;
    row.hidden = !visible;
    setStyle(row, 'display', visible ? '' : 'none');
  };

  const syncDrawer = () => {
    if (!drawerEl || !isOpen) return;
    const link = setting.link;

    if (isEnum) {
      const enumSpec = spec as EnumSpec;
      const cd = link?.cooldownSec ?? LINK_COOLDOWN_DEFAULT;
      for (const chip of chipButtons) {
        const active = Boolean(
          link &&
          chip.enumLink &&
          link.source === chip.enumLink.source &&
          cd === (chip.enumLink.cooldownSec ?? LINK_COOLDOWN_DEFAULT),
        );
        setClass(chip.btn, 'mv-react-chip-active', active);
      }
      if (enumTriggerSelect) enumTriggerSelect.value = link?.source ?? 'section';
      if (enumCooldownInput) enumCooldownInput.value = String(cd);
      if (enumCooldownVal) enumCooldownVal.textContent = `${Math.round(cd)}s`;

      const activeOpts = link?.enumOptions?.length ? link.enumOptions : enumSpec.options;
      for (const item of enumOptButtons) {
        setClass(item.btn, 'mv-react-opt-chip-active', activeOpts.includes(item.opt));
      }
      return;
    }

    const matched = isColour ? matchingColourRecipeId(link) : matchingRecipeId(link);
    for (const chip of chipButtons) {
      setClass(chip.btn, 'mv-react-chip-active', chip.id === matched);
    }

    if (sourceSelect) sourceSelect.value = link?.source ?? (isColour ? 'phrase32' : 'bass');
    if (modeSelect) modeSelect.value = link?.mode ?? (isColour ? 'bipolar' : 'add');
    if (curveSelect) curveSelect.value = link?.curve ?? 'linear';

    const amt = link?.amount ?? 0;
    if (amountInput) amountInput.value = String(amt);
    if (amountVal) {
      if (isColour) {
        const deg = Math.round(amt * 360);
        amountVal.textContent = `${deg >= 0 ? '+' : ''}${deg}°`;
      } else {
        const pct = Math.round(amt * 100);
        amountVal.textContent = `${pct >= 0 ? '+' : ''}${pct}%`;
      }
    }

    const sm = link?.smooth ?? (isColour ? 0.55 : 0.2);
    if (smoothInput) smoothInput.value = String(sm);
    if (smoothVal) smoothVal.textContent = sm.toFixed(2);

    const showGate = link?.curve === 'gate';
    setRowVisible(gateRow, Boolean(showGate));
    const th = link?.threshold ?? LINK_THRESHOLD_DEFAULT;
    if (gateInput) gateInput.value = String(th);
    if (gateVal) gateVal.textContent = th.toFixed(2);

    const showSlew = Boolean(link?.mode?.startsWith('flip'));
    setRowVisible(slewRow, showSlew);
    const slew = link?.flipSlew ?? LINK_FLIP_SLEW_DEFAULT;
    if (slewInput) slewInput.value = String(slew);
    if (slewVal) slewVal.textContent = `${slew.toFixed(2)}s`;

    const showRate = Boolean(link?.source?.startsWith('lfo'));
    setRowVisible(rateRow, showRate);
    const rate = link?.rate ?? LFO_RATE_DEFAULT;
    if (rateInput) rateInput.value = String(rate);
    if (rateVal) rateVal.textContent = `${rate.toFixed(2)} Hz`;

    if (isNumeric && allowMorph) {
      const numSpec = spec as NumberSpec;
      const morph = setting.morph;
      if (morphToggle) morphToggle.checked = Boolean(morph);
      setRowVisible(morphFields, Boolean(morph));
      const mTo = morph?.to ?? defaultMorphTarget(numSpec, setting.value);
      if (morphToInput) morphToInput.value = String(mTo);
      if (morphToVal) morphToVal.textContent = formatNumber(mTo, numSpec.step);

      const mRate = morph?.rate ?? MORPH_RATE_DEFAULT;
      if (morphRateInput) morphRateInput.value = String(mRate);
      if (morphRateVal) morphRateVal.textContent = `${mRate.toFixed(2)} Hz`;
    }
  };

  const syncVisual = () => {
    const active = Boolean(setting.link || setting.morph);
    setClass(boltBtn, 'mv-react-bolt-active', active);
    if (isEnum) {
      boltBtn.title = setting.link
        ? `${setting.link.source} · ${setting.link.cooldownSec ?? LINK_COOLDOWN_DEFAULT}s`
        : `Add reactivity to ${spec.label}`;
    } else {
      const summary = summarizeAudioLink(setting.link, setting.morph);
      boltBtn.title = summary ? `Reactivity: ${summary}` : `Add reactivity to ${spec.label}`;
    }
    syncDrawer();
  };

  const makeSelectField = (
    labelText: string,
    options: readonly string[],
    onChange: (value: string) => void,
  ): { wrap: HTMLElement; select: HTMLSelectElement } => {
    const wrap = doc.createElement('label');
    wrap.className = 'mv-react-field';
    const lbl = doc.createElement('span');
    lbl.className = 'mv-react-field-label';
    lbl.textContent = labelText;
    const select = doc.createElement('select');
    select.className = 'mv-react-select';
    for (const optVal of options) {
      const opt = doc.createElement('option');
      opt.value = optVal;
      opt.setAttribute?.('value', optVal);
      opt.textContent = optVal;
      select.appendChild(opt);
    }
    select.addEventListener?.('change', () => onChange(select.value));
    wrap.append(lbl, select);
    return { wrap, select };
  };

  const makeSliderRow = (
    labelText: string,
    min: number,
    max: number,
    step: number,
    onInput: (val: number, discrete: boolean) => void,
  ): { row: HTMLElement; input: HTMLInputElement; valEl: HTMLElement } => {
    const row = doc.createElement('div');
    row.className = 'mv-react-slider-row';
    const head = doc.createElement('div');
    head.className = 'mv-react-slider-head';
    const lbl = doc.createElement('span');
    lbl.className = 'mv-react-field-label';
    lbl.textContent = labelText;
    const valEl = doc.createElement('span');
    valEl.className = 'mv-react-slider-val';
    head.append(lbl, valEl);

    const input = doc.createElement('input');
    input.type = 'range';
    input.className = 'mv-react-range';
    input.setAttribute?.('min', String(min));
    input.setAttribute?.('max', String(max));
    input.setAttribute?.('step', String(step));
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener?.('input', () => onInput(Number(input.value), false));
    input.addEventListener?.('change', () => onInput(Number(input.value), true));

    row.append(head, input);
    return { row, input, valEl };
  };

  const buildDrawer = (): HTMLElement => {
    const root = doc.createElement('div');
    root.className = 'mv-react-drawer';

    // Header
    const header = doc.createElement('div');
    header.className = 'mv-react-header';
    const title = doc.createElement('span');
    title.className = 'mv-react-title';
    title.textContent = isEnum
      ? `⚡ ${spec.label} Switching`
      : isColour
        ? `⚡ ${spec.label} Hue Shift`
        : `⚡ ${spec.label} Reactivity`;

    const headerActions = doc.createElement('div');
    headerActions.className = 'mv-react-header-actions';

    const clearBtn = doc.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'mv-react-clear-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener?.('click', () => {
      clearSettingProp(setting, 'link');
      clearSettingProp(setting, 'morph');
      onClear?.();
      syncVisual();
      updateLiveOverlay(undefined, false);
      onMutate(true);
    });

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mv-react-close-btn';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute?.('aria-label', 'Close reactivity drawer');
    closeBtn.addEventListener?.('click', () => closeDrawer());

    headerActions.append(clearBtn, closeBtn);
    header.append(title, headerActions);
    root.append(header);

    if (isEnum) {
      const enumSpec = spec as EnumSpec;
      const chipsRow = doc.createElement('div');
      chipsRow.className = 'mv-react-chips';
      chipButtons = [];
      for (const presetChip of ENUM_TRIGGER_CHIPS) {
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'mv-react-chip';
        chip.textContent = presetChip.label;
        chip.setAttribute?.('data-recipe-id', presetChip.id);
        chip.addEventListener?.('click', () => {
          const prevOpts = setting.link?.enumOptions;
          setting.link = {
            ...presetChip.link,
            ...(prevOpts?.length ? { enumOptions: [...prevOpts] } : {}),
          };
          syncVisual();
          onMutate(true);
        });
        chipButtons.push({ id: presetChip.id, btn: chip, enumLink: presetChip.link });
        chipsRow.append(chip);
      }
      root.append(chipsRow);

      const trigField = makeSelectField('Trigger', ENUM_TRIGGER_SOURCES, (val) => {
        const link = ensureLink();
        link.source = val as AudioSource;
        syncVisual();
        onMutate(true);
      });
      enumTriggerSelect = trigField.select;
      root.append(trigField.wrap);

      const cdRow = makeSliderRow(
        'Cooldown (s)',
        LINK_COOLDOWN_MIN,
        LINK_COOLDOWN_MAX,
        1,
        (v, discrete) => {
          const link = ensureLink();
          link.cooldownSec = Math.round(v);
          syncVisual();
          onMutate(discrete);
        },
      );
      enumCooldownInput = cdRow.input;
      enumCooldownVal = cdRow.valEl;
      root.append(cdRow.row);

      const optsWrap = doc.createElement('div');
      optsWrap.className = 'mv-react-field';
      const optsLabel = doc.createElement('span');
      optsLabel.className = 'mv-react-field-label';
      optsLabel.textContent = 'Options';
      const optChipsRow = doc.createElement('div');
      optChipsRow.className = 'mv-react-opt-chips';
      enumOptButtons = [];

      for (const opt of enumSpec.options) {
        const optBtn = doc.createElement('button');
        optBtn.type = 'button';
        optBtn.className = 'mv-react-opt-chip';
        optBtn.textContent = opt;
        optBtn.setAttribute?.('data-enum-option', opt);
        optBtn.addEventListener?.('click', () => {
          const link = ensureLink();
          const current = link.enumOptions?.length
            ? link.enumOptions.filter((o) => enumSpec.options.includes(o))
            : [...enumSpec.options];
          let next: string[];
          if (current.includes(opt)) {
            if (current.length <= 1) return;
            next = current.filter((o) => o !== opt);
          } else {
            next = enumSpec.options.filter((o) => current.includes(o) || o === opt);
          }
          if (next.length >= enumSpec.options.length) {
            delete link.enumOptions;
          } else {
            link.enumOptions = next;
          }
          syncVisual();
          onMutate(true);
        });
        enumOptButtons.push({ opt, btn: optBtn });
        optChipsRow.append(optBtn);
      }

      optsWrap.append(optsLabel, optChipsRow);
      root.append(optsWrap);
      return root;
    }

    // 1-click recipe chips (numeric or colour)
    const chipsRow = doc.createElement('div');
    chipsRow.className = 'mv-react-chips';
    chipButtons = [];
    if (isColour) {
      for (const recipe of COLOUR_RECIPES) {
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'mv-react-chip';
        chip.textContent = recipe.label;
        chip.setAttribute?.('data-recipe-id', recipe.id);
        chip.addEventListener?.('click', () => {
          setting.link = { ...recipe.link };
          syncVisual();
          onMutate(true);
        });
        chipButtons.push({ id: recipe.id, btn: chip });
        chipsRow.append(chip);
      }
    } else {
      const numSpec = spec as NumberSpec;
      for (const recipe of LINK_RECIPES) {
        const chip = doc.createElement('button');
        chip.type = 'button';
        chip.className = 'mv-react-chip';
        chip.textContent = recipe.label;
        chip.title = recipe.description;
        chip.setAttribute?.('data-recipe-id', recipe.id);
        chip.addEventListener?.('click', () => {
          setting.link = buildRecipeLink(recipe.id, numSpec);
          syncVisual();
          onMutate(true);
        });
        chipButtons.push({ id: recipe.id, btn: chip });
        chipsRow.append(chip);
      }
    }
    root.append(chipsRow);

    // 3-column selects: Source / Mode / Curve
    const grid = doc.createElement('div');
    grid.className = 'mv-react-grid';

    const srcField = makeSelectField('Source', AUDIO_SOURCES, (val) => {
      const link = ensureLink();
      link.source = val as AudioSource;
      if (link.source.startsWith('lfo') && link.rate === undefined) {
        link.rate = LFO_RATE_DEFAULT;
      }
      syncVisual();
      onMutate(true);
    });
    sourceSelect = srcField.select;

    const modeField = makeSelectField('Mode', LINK_MODES, (val) => {
      const link = ensureLink();
      link.mode = val as LinkMode;
      if (link.mode.startsWith('flip') && link.flipSlew === undefined) {
        link.flipSlew = LINK_FLIP_SLEW_DEFAULT;
      }
      syncVisual();
      onMutate(true);
    });
    modeSelect = modeField.select;

    const curveField = makeSelectField('Curve', LINK_CURVES, (val) => {
      const link = ensureLink();
      link.curve = val as LinkCurve;
      if (link.curve === 'gate' && link.threshold === undefined) {
        link.threshold = LINK_THRESHOLD_DEFAULT;
      }
      syncVisual();
      onMutate(true);
    });
    curveSelect = curveField.select;

    grid.append(srcField.wrap, modeField.wrap, curveField.wrap);
    root.append(grid);

    // Mini sliders
    const sliders = doc.createElement('div');
    sliders.className = 'mv-react-sliders';

    const amt = makeSliderRow(isColour ? 'Hue Depth' : 'Amount', -1, 1, 0.02, (v, discrete) => {
      const link = ensureLink();
      link.amount = v;
      syncVisual();
      onMutate(discrete);
    });
    amountInput = amt.input;
    amountVal = amt.valEl;

    const sm = makeSliderRow('Smooth', 0, 1, 0.02, (v, discrete) => {
      const link = ensureLink();
      link.smooth = v;
      syncVisual();
      onMutate(discrete);
    });
    smoothInput = sm.input;
    smoothVal = sm.valEl;

    const gate = makeSliderRow('Gate Threshold', LINK_THRESHOLD_MIN, LINK_THRESHOLD_MAX, 0.02, (v, discrete) => {
      const link = ensureLink();
      link.threshold = v;
      syncVisual();
      onMutate(discrete);
    });
    gateRow = gate.row;
    gateInput = gate.input;
    gateVal = gate.valEl;

    const slew = makeSliderRow('Flip Slew', LINK_FLIP_SLEW_MIN, LINK_FLIP_SLEW_MAX, 0.05, (v, discrete) => {
      const link = ensureLink();
      link.flipSlew = v;
      syncVisual();
      onMutate(discrete);
    });
    slewRow = slew.row;
    slewInput = slew.input;
    slewVal = slew.valEl;

    const lfoRate = makeSliderRow('LFO Rate', LFO_RATE_MIN, LFO_RATE_MAX, 0.05, (v, discrete) => {
      const link = ensureLink();
      link.rate = v;
      syncVisual();
      onMutate(discrete);
    });
    rateRow = lfoRate.row;
    rateInput = lfoRate.input;
    rateVal = lfoRate.valEl;

    sliders.append(amt.row, sm.row, gate.row, slew.row, lfoRate.row);
    root.append(sliders);

    // Inline Morph controls (numeric only when allowMorph is true)
    if (isNumeric && allowMorph) {
      const numSpec = spec as NumberSpec;
      const morphSection = doc.createElement('div');
      morphSection.className = 'mv-react-morph';

      const morphLabel = doc.createElement('label');
      morphLabel.className = 'mv-react-morph-toggle';
      const mCheck = doc.createElement('input');
      mCheck.type = 'checkbox';
      mCheck.addEventListener?.('change', () => {
        if (mCheck.checked) {
          setting.morph = { to: defaultMorphTarget(numSpec, setting.value), rate: MORPH_RATE_DEFAULT };
        } else {
          clearSettingProp(setting, 'morph');
        }
        syncVisual();
        if (!setting.link && !setting.morph) updateLiveOverlay(undefined, false);
        onMutate(true);
      });
      morphToggle = mCheck;
      const mText = doc.createElement('span');
      mText.textContent = 'Morph';
      morphLabel.append(mCheck, mText);

      const mFields = doc.createElement('div');
      mFields.className = 'mv-react-morph-fields';
      morphFields = mFields;

      const mTo = makeSliderRow('To', numSpec.min, numSpec.max, numSpec.step, (v, discrete) => {
        if (!setting.morph) {
          setting.morph = { to: v, rate: MORPH_RATE_DEFAULT };
        } else {
          setting.morph.to = numSpec.type === 'int' ? Math.round(v) : v;
        }
        syncVisual();
        onMutate(discrete);
      });
      morphToInput = mTo.input;
      morphToVal = mTo.valEl;

      const mRate = makeSliderRow('Rate', MORPH_RATE_MIN, MORPH_RATE_MAX, 0.02, (v, discrete) => {
        if (!setting.morph) {
          setting.morph = { to: defaultMorphTarget(numSpec, setting.value), rate: v };
        } else {
          setting.morph.rate = v;
        }
        syncVisual();
        onMutate(discrete);
      });
      morphRateInput = mRate.input;
      morphRateVal = mRate.valEl;

      mFields.append(mTo.row, mRate.row);
      morphSection.append(morphLabel, mFields);
      root.append(morphSection);
    }

    return root;
  };

  const openDrawer = () => {
    if (disposed || isOpen) return;
    if (!drawerEl) {
      drawerEl = buildDrawer();
    }
    insertAfter(el, drawerEl);
    isOpen = true;
    setClass(boltBtn, 'mv-react-bolt-open', true);
    boltBtn.setAttribute?.('aria-expanded', 'true');
    syncDrawer();
    onDrawerToggle?.(handle);
  };

  const closeDrawer = () => {
    if (!isOpen) return;
    isOpen = false;
    removeEl(drawerEl);
    setClass(boltBtn, 'mv-react-bolt-open', false);
    boltBtn.setAttribute?.('aria-expanded', 'false');
    onDrawerToggle?.(null);
  };

  const updateLiveOverlay = (resolvedValue: number | undefined, calm: boolean) => {
    if (!isNumeric || !bandEl || !dotEl) return;
    const numSpec = spec as NumberSpec;
    if ((!setting.link && !setting.morph) || resolvedValue === undefined || !Number.isFinite(resolvedValue)) {
      setStyle(bandEl, 'display', 'none');
      setStyle(dotEl, 'display', 'none');
      return;
    }

    const span = numSpec.max - numSpec.min;
    if (!(span > 0)) {
      setStyle(bandEl, 'display', 'none');
      setStyle(dotEl, 'display', 'none');
      return;
    }

    const base = typeof setting.value === 'number' ? setting.value : numSpec.default;
    let lo = base;
    let hi = base;

    if (setting.morph) {
      lo = Math.min(lo, setting.morph.to);
      hi = Math.max(hi, setting.morph.to);
    }

    if (setting.link) {
      const link = setting.link;
      const calmMult = calm ? (numSpec.intense ? 0.2 : 0.35) : 1.0;
      const delta = link.amount * calmMult * span;
      const mode = link.mode ?? 'add';
      const startMin = lo;
      const startMax = hi;

      if (mode === 'bipolar') {
        lo = startMin - Math.abs(delta);
        hi = startMax + Math.abs(delta);
      } else if (mode === 'flipOnBeat' || mode === 'flipOnDrop' || mode === 'flipOnSection') {
        const neutral = neutralPointForSpec(numSpec);
        const candidates = [
          startMin,
          startMin + delta,
          startMax,
          startMax + delta,
          2 * neutral - startMin,
          2 * neutral - (startMin + delta),
          2 * neutral - startMax,
          2 * neutral - (startMax + delta),
        ];
        lo = Math.min(...candidates);
        hi = Math.max(...candidates);
      } else {
        lo = Math.min(startMin, startMin + delta, startMax, startMax + delta);
        hi = Math.max(startMin, startMin + delta, startMax, startMax + delta);
      }

      if (link.minBound !== undefined || link.maxBound !== undefined) {
        let loN = link.minBound !== undefined && Number.isFinite(link.minBound) ? clamp01(link.minBound) : 0;
        let hiN = link.maxBound !== undefined && Number.isFinite(link.maxBound) ? clamp01(link.maxBound) : 1;
        if (loN > hiN) [loN, hiN] = [hiN, loN];
        const boundLo = numSpec.min + loN * span;
        const boundHi = numSpec.min + hiN * span;
        lo = Math.min(boundHi, Math.max(boundLo, lo));
        hi = Math.min(boundHi, Math.max(boundLo, hi));
      }
    }

    lo = Math.min(numSpec.max, Math.max(numSpec.min, lo));
    hi = Math.min(numSpec.max, Math.max(numSpec.min, hi));

    const pctLo = Math.min(100, Math.max(0, ((lo - numSpec.min) / span) * 100));
    const pctHi = Math.min(100, Math.max(0, ((hi - numSpec.min) / span) * 100));
    const pctDot = Math.min(100, Math.max(0, ((resolvedValue - numSpec.min) / span) * 100));

    setStyle(bandEl, 'display', 'block');
    setStyle(bandEl, 'left', `${pctLo.toFixed(2)}%`);
    setStyle(bandEl, 'width', `${Math.max(1.5, pctHi - pctLo).toFixed(2)}%`);

    setStyle(dotEl, 'display', 'block');
    setStyle(dotEl, 'left', `${pctDot.toFixed(2)}%`);
  };

  const dispose = () => {
    disposed = true;
    closeDrawer();
    removeEl(boltBtn);
    removeEl(bandEl);
    removeEl(dotEl);
    drawerEl = null;
  };

  boltBtn.addEventListener?.('click', (ev: Event) => {
    ev?.stopPropagation?.();
    if (isOpen) closeDrawer();
    else openDrawer();
  });

  const handle: ReactiveSliderHandle = {
    meterKey,
    openDrawer,
    closeDrawer,
    syncVisual,
    updateLiveOverlay,
    dispose,
  };

  syncVisual();
  return handle;
}
