// Builds the Tweakpane controls for one layer, the Feedback / Warp / Post section, a single setting, and the Global Director.
import { applyPresetToScene } from '../presets/loader';
import { LAYER_SPECS, tierOf } from '../presets/layerSchemas';
import { BLEND_MODES, BLEND_SPEC, OPACITY_SPEC, TRAILS_SPEC, type AudioLink, type LayerEntry, type Preset, type Settings, type Setting } from '../presets/format';
import { attachReactiveSlider, type ReactiveSliderHandle } from './reactiveSlider';
import { type Scene } from '../render/scene';
import { isSpecVisible, type ParamSpec, type ParamValue } from '../presets/schema';
import { DEFAULT_CUSTOM_SHADOW_TINT, DEFAULT_CUSTOM_HIGHLIGHT_TINT, getGlobalDirector, type ExperienceMode, type CameraMode, type ColorMood, type TriggerCadence } from '../render/globalDirector';
import { formatEnumOptionLabel } from './labels';
import { type ControlHelperDescriptor, attachControlHelper, attachSpecHelper, attachResetControl } from './helperBar';
import { type StudioView, viewSubscribers, loadStudioView, saveStudioView, isSpecShown } from './studioView';

export interface ReactiveSectionContext {
  scopePrefix: string;
  scopeForSpec?: (specName: string) => string;
  onDrawerToggle?: (handle: ReactiveSliderHandle | null) => void;
  registerHandle?: (handle: ReactiveSliderHandle) => void;
  onReactiveMutate?: (discrete: boolean, apply?: () => void) => void;
  onRegisterTarget?: (
    meterKey: string,
    handle: ReactiveSliderHandle,
    folders: Array<{ expanded: boolean }>,
    element?: HTMLElement,
    apply?: () => void,
  ) => void;
}

export interface OpacityReactiveOptions {
  meterKey: string;
  onMutate: (discrete: boolean) => void;
  onDrawerToggle?: (handle: ReactiveSliderHandle | null) => void;
  registerHandle?: (handle: ReactiveSliderHandle) => void;
  onRegisterTarget?: (handle: ReactiveSliderHandle, element?: HTMLElement) => void;
}

export function isLinkableSpecType(t: ParamSpec['type']): boolean {
  return t === 'float' || t === 'int' || t === 'enum' || t === 'colour';
}

/** Default morph end: a quarter of the range away from the value, on whichever side has room, kept in range. */
export function morphTargetFor(spec: Extract<ParamSpec, { type: 'float' | 'int' }>, value: ParamValue): number {
  const base = typeof value === 'number' ? value : spec.default;
  const quarter = (spec.max - spec.min) * 0.25;
  let to = base + quarter;
  if (to > spec.max) to = base - quarter;
  to = Math.min(spec.max, Math.max(spec.min, to));
  return spec.type === 'int' ? Math.round(to) : to;
}

/** A new layer with the schema defaults, enabled, full opacity. */
export function defaultLayer(type: string): LayerEntry {
  const params: Settings = {};
  for (const spec of LAYER_SPECS[type] ?? []) params[spec.name] = { value: spec.default };
  // New particle layers follow the scene by default (2026-11-06). Existing presets keep their stored value.
  if (type === 'particles') params.followScene = { value: true };
  return { type, enabled: true, opacity: 1, blend: 'add', params };
}

if (!(OPACITY_SPEC as any).key) (OPACITY_SPEC as any).key = OPACITY_SPEC.name;
if (!(BLEND_SPEC as any).key) (BLEND_SPEC as any).key = BLEND_SPEC.name;
if (!(TRAILS_SPEC as any).key) (TRAILS_SPEC as any).key = TRAILS_SPEC.name;

export function buildLayerControls(
  pane: { addBinding: (target: any, prop: any, options?: any) => any },
  entry: LayerEntry,
  p: Preset,
  currentScene: Scene,
  session: { commit: (arg?: any, ...rest: any[]) => void },
  gl?: WebGL2RenderingContext,
  id?: string,
  onHelperUpdate?: (spec: ParamSpec | null) => void,
  onEdit?: () => void,
  opacityReactive?: OpacityReactiveOptions,
): { opacityBinding: any; blendBinding: any; trailsBinding: any } {
  let opacityHandle: ReactiveSliderHandle | null = null;
  const onLayerConfigChange = () => {
    applyPresetToScene(p, currentScene, gl);
    try {
      (session as any).commit(true);
    } catch {
      // ignore
    }
    if (id && typeof id === 'string') {
      try {
        session.commit(id, Date.now(), true);
      } catch {
        // ignore
      }
    }
    onEdit?.();
    opacityHandle?.syncVisual();
  };

  const opacityKey = (OPACITY_SPEC as any).key ?? OPACITY_SPEC.name;
  const opacityBinding = pane.addBinding(entry as unknown as Record<string, unknown>, opacityKey, {
    label: OPACITY_SPEC.label,
    min: OPACITY_SPEC.min,
    max: OPACITY_SPEC.max,
    step: OPACITY_SPEC.step,
  }).on('change', onLayerConfigChange);
  attachSpecHelper(opacityBinding, OPACITY_SPEC, onHelperUpdate);
  attachResetControl([opacityBinding], OPACITY_SPEC, entry as any, opacityKey, onLayerConfigChange);

  if (opacityReactive && opacityBinding) {
    const opacitySetting: Setting = {
      get value() {
        return entry.opacity;
      },
      set value(v: ParamValue) {
        entry.opacity = Number(v);
      },
      get link() {
        return entry.opacityLink;
      },
      set link(l: AudioLink | undefined) {
        if (l) entry.opacityLink = l;
        else delete entry.opacityLink;
      },
    };
    opacityHandle = attachReactiveSlider({
      blade: opacityBinding,
      spec: OPACITY_SPEC,
      setting: opacitySetting,
      meterKey: opacityReactive.meterKey,
      allowMorph: false,
      onClear: () => {
        delete entry.opacityLink;
      },
      onMutate: opacityReactive.onMutate,
      onDrawerToggle: opacityReactive.onDrawerToggle,
    });
    opacityReactive.registerHandle?.(opacityHandle);
    opacityReactive.onRegisterTarget?.(opacityHandle, opacityBinding?.element);
  }

  const blendKey = (BLEND_SPEC as any).key ?? BLEND_SPEC.name;
  const blendBinding = pane.addBinding(entry as unknown as Record<string, unknown>, blendKey, {
    label: BLEND_SPEC.label,
    options: Object.fromEntries(BLEND_MODES.map((b) => [formatEnumOptionLabel(b), b])),
  }).on('change', onLayerConfigChange);
  attachSpecHelper(blendBinding, BLEND_SPEC, onHelperUpdate);
  attachResetControl([blendBinding], BLEND_SPEC, entry as any, blendKey, onLayerConfigChange);

  if (entry.trails === undefined) {
    entry.trails = TRAILS_SPEC.default;
  }
  const trailsKey = (TRAILS_SPEC as any).key ?? TRAILS_SPEC.name;
  const trailsBinding = pane.addBinding(entry as unknown as Record<string, unknown>, trailsKey, {
    label: TRAILS_SPEC.label,
  }).on('change', onLayerConfigChange);
  attachSpecHelper(trailsBinding, TRAILS_SPEC, onHelperUpdate);
  attachResetControl([trailsBinding], TRAILS_SPEC, entry as any, trailsKey, onLayerConfigChange);

  return { opacityBinding, blendBinding, trailsBinding };
}

/**
 * Bind a list of parameter specs in a section, dynamically updating blade visibility
 * whenever any parameter changes via `isSpecVisible`.
 */
/**
 * One settings view over a feedback and a post settings bag. Reads and writes go to the post bag for
 * names in `postNames` and to the feedback bag for everything else, so keys and saved data are unchanged.
 */
export function mergeSettings(feedback: Settings, post: Settings, postNames: ReadonlySet<string>): Settings {
  const bagOf = (name: string | symbol): Settings => (typeof name === 'string' && postNames.has(name) ? post : feedback);
  return new Proxy({} as Settings, {
    get: (_t, name) => (bagOf(name) as any)[name],
    set: (_t, name, value) => { (bagOf(name) as any)[name] = value; return true; },
    has: (_t, name) => name in bagOf(name),
  });
}

export function bindSection(
  pane: any,
  title: string,
  specs: readonly ParamSpec[],
  settings: Settings | Record<string, any>,
  apply?: () => void,
  onCommit?: () => void,
  onHelperUpdate?: (spec: ParamSpec | null) => void,
  onEdit?: (spec: ParamSpec, value: number | boolean | string) => void,
  reactiveCtx?: ReactiveSectionContext,
): { specBindings: Array<{ spec: ParamSpec; blades: any[] }>; updateVisibility: () => void; folders: any[] } {
  if (specs.length === 0) return { specBindings: [], updateVisibility: () => {}, folders: [] };
  const folders: any[] = [];
  const sectionTitle = title.charAt(0).toUpperCase() + title.slice(1);
  const sectionFolder = typeof pane.addFolder === 'function'
    ? pane.addFolder({ title: sectionTitle, expanded: false })
    : pane;
  if (sectionFolder && sectionFolder !== pane) {
    folders.push(sectionFolder);
  }

  const holder: Record<string, ParamValue> = {};
  for (const spec of specs) {
    const s = settings[spec.name];
    if (s !== null && typeof s === 'object' && 'value' in s && !Array.isArray(s)) {
      holder[spec.name] = s.value;
    } else if (spec.name in settings) {
      holder[spec.name] = (settings as any)[spec.name];
    } else {
      holder[spec.name] = spec.default;
    }
  }

  const specBindings: Array<{ spec: ParamSpec; blades: any[] }> = [];
  const reactiveHandles: Array<{ spec: ParamSpec; handle: ReactiveSliderHandle }> = [];
  const groupFolders: Array<{ folder: any; members: Array<{ spec: ParamSpec; blades: any[] }> }> = [];
  const viewHolder: { view: StudioView } = { view: loadStudioView() };
  // A section with no tiered controls (layers registered elsewhere) has no Basic view: show everything, no toggle.
  const tiered = specs.some((s) => tierOf(s) === 'basic');
  const hasAdvanced = tiered && specs.some((s) => tierOf(s) === 'advanced');
  const viewNow = (): StudioView => (tiered ? viewHolder.view : 'advanced');

  const updateVisibility = () => {
    for (const { spec, blades } of specBindings) {
      const visible = isSpecShown(spec, holder, viewNow());
      for (const b of blades) {
        if (b && typeof b === 'object') {
          b.hidden = !visible;
        }
      }
    }
    for (const { spec, handle } of reactiveHandles) {
      if (!isSpecShown(spec, holder, viewNow())) {
        handle.closeDrawer();
      }
    }
    // A group folder with nothing to show hides too.
    for (const { folder, members } of groupFolders) {
      const any = members.some((m) => isSpecShown(m.spec, holder, viewNow()));
      if (folder && typeof folder === 'object') folder.hidden = !any;
    }
  };

  let viewBinding: any;
  if (hasAdvanced && typeof sectionFolder.addBinding === 'function') {
    viewBinding = sectionFolder.addBinding(viewHolder, 'view', {
      label: 'View',
      options: { Basic: 'basic', Advanced: 'advanced' },
    });
    viewBinding?.on?.('change', () => {
      saveStudioView(viewHolder.view);
      for (const notify of [...viewSubscribers]) notify(viewHolder.view);
    });
    attachControlHelper(
      viewBinding,
      {
        label: 'View',
        description: 'Basic shows the main controls. Advanced shows every setting in each section.',
      },
      onHelperUpdate as ((info: ParamSpec | ControlHelperDescriptor | null) => void) | undefined,
    );
    const onView = (v: StudioView) => {
      try {
        if (viewHolder.view !== v) {
          viewHolder.view = v;
          viewBinding?.refresh?.();
        }
        updateVisibility();
      } catch {
        // section was disposed
      }
    };
    viewSubscribers.add(onView);
  }

  const groups = new Map<string, ParamSpec[]>();
  for (const spec of specs) {
    const gname = spec.uiGroup ?? spec.group;
    const list = groups.get(gname);
    if (list) {
      list.push(spec);
    } else {
      groups.set(gname, [spec]);
    }
  }

  for (const [groupName, groupSpecs] of groups) {
    const target = groupName && typeof sectionFolder.addFolder === 'function'
      ? sectionFolder.addFolder({ title: groupName, expanded: false })
      : sectionFolder;
    const members: Array<{ spec: ParamSpec; blades: any[] }> = [];
    if (target && target !== sectionFolder && target !== pane) {
      folders.push(target);
      groupFolders.push({ folder: target, members });
    }
    for (const spec of groupSpecs) {
      let reactiveHandle: ReactiveSliderHandle | null = null;
      const existingSetting = settings[spec.name];
      const settingObj: Setting =
        existingSetting !== null && typeof existingSetting === 'object' && 'value' in existingSetting
          ? (existingSetting as Setting)
          : { value: holder[spec.name] };
      const push = () => {
        onCommit?.();
        const s = settings[spec.name];
        if (s !== null && typeof s === 'object' && 'value' in s && !Array.isArray(s)) {
          s.value = holder[spec.name]!;
        } else if (reactiveCtx && isLinkableSpecType(spec.type)) {
          settingObj.value = holder[spec.name]!;
          (settings as Settings)[spec.name] = settingObj;
        } else {
          (settings as any)[spec.name] = holder[spec.name]!;
        }
        updateVisibility();
        apply?.();
        reactiveHandle?.syncVisual();
        const value = holder[spec.name];
        if (onEdit && (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string')) {
          onEdit(spec, value);
        }
      };
      const binding = bindSpec(target, spec.label, spec, holder, push, onHelperUpdate);
      const blades = Array.isArray(binding) ? binding : [binding];
      const entry = { spec, blades };
      specBindings.push(entry);
      members.push(entry);

      if (reactiveCtx && isLinkableSpecType(spec.type) && blades[0]) {
        const scope = reactiveCtx.scopeForSpec ? reactiveCtx.scopeForSpec(spec.name) : reactiveCtx.scopePrefix;
        const meterKey = `${scope}.${spec.name}`;
        reactiveHandle = attachReactiveSlider({
          blade: blades[0],
          spec: spec as any,
          setting: settingObj,
          meterKey,
          onMutate: (discrete) => {
            if (settings[spec.name] !== settingObj) {
              settingObj.value = holder[spec.name]!;
              (settings as Settings)[spec.name] = settingObj;
            }
            reactiveCtx.onReactiveMutate?.(discrete, apply);
          },
          onDrawerToggle: reactiveCtx.onDrawerToggle,
        });
        reactiveHandles.push({ spec, handle: reactiveHandle });
        reactiveCtx.registerHandle?.(reactiveHandle);
        const owningFolders: Array<{ expanded: boolean }> = [];
        if (sectionFolder && sectionFolder !== pane) owningFolders.push(sectionFolder);
        if (target && target !== sectionFolder && target !== pane) owningFolders.push(target);
        reactiveCtx.onRegisterTarget?.(meterKey, reactiveHandle, owningFolders, blades[0]?.element, apply);
      }
    }
  }

  updateVisibility();

  return { specBindings, updateVisibility, folders };
}

export function bindSpec(
  pane: any,
  labelOrSpec: string | ParamSpec,
  specOrHolder: ParamSpec | Record<string, ParamValue>,
  holderOrOnChange?: Record<string, ParamValue> | (() => void),
  maybeOnChange?: (() => void) | ((spec: ParamSpec | null) => void),
  maybeOnHelperUpdate?: (spec: ParamSpec | null) => void,
): any {
  let label: string;
  let spec: ParamSpec;
  let holder: Record<string, ParamValue>;
  let onChange: () => void;
  let onHelperUpdate: ((spec: ParamSpec | null) => void) | undefined;

  if (typeof labelOrSpec === 'string') {
    label = labelOrSpec;
    spec = specOrHolder as ParamSpec;
    holder = holderOrOnChange as Record<string, ParamValue>;
    onChange = maybeOnChange as () => void;
    onHelperUpdate = maybeOnHelperUpdate;
  } else {
    spec = labelOrSpec as ParamSpec;
    holder = specOrHolder as Record<string, ParamValue>;
    onChange = holderOrOnChange as () => void;
    label = spec.label;
    onHelperUpdate = maybeOnChange as ((spec: ParamSpec | null) => void) | undefined;
  }

  const key = ((spec as any).key ?? spec.name) as string;
  const target = holder as Record<string, unknown>;

  let result: any;
  switch (spec.type) {
    case 'float':
    case 'int':
      result = pane.addBinding(target, key, { label, min: spec.min, max: spec.max, step: spec.step }).on('change', onChange);
      break;
    case 'bool':
      result = pane.addBinding(target, key, { label }).on('change', onChange);
      break;
    case 'enum':
      result = pane.addBinding(target, key, { label, options: Object.fromEntries(spec.options.map((o) => [formatEnumOptionLabel(o), o])) }).on('change', onChange);
      break;
    case 'colour':
      result = pane.addBinding(target, key, { label, view: 'color' }).on('change', onChange);
      break;
    case 'vec3': {
      if (!Array.isArray(holder[key])) {
        holder[key] = ((spec as any).default ? [...(spec as any).default] : [1.0, 1.0, 1.0]) as [number, number, number];
      }
      const vec = holder[key] as [number, number, number];
      const min = (spec as any).min ?? 0.0;
      const max = (spec as any).max ?? 1.0;
      const step = (spec as any).step ?? 0.01;
      const labelPrefix = spec.label ?? label;

      const b0 = pane.addBinding(vec, 0, { label: `${labelPrefix} R`, min, max, step }).on('change', onChange);
      const b1 = pane.addBinding(vec, 1, { label: `${labelPrefix} G`, min, max, step }).on('change', onChange);
      const b2 = pane.addBinding(vec, 2, { label: `${labelPrefix} B`, min, max, step }).on('change', onChange);
      result = [b0, b1, b2];
      break;
    }
  }

  const visible = isSpecVisible(spec, holder);
  const blades = Array.isArray(result) ? result : [result];
  for (const b of blades) {
    if (b && typeof b === 'object') {
      b.hidden = !visible;
      attachSpecHelper(b, spec, onHelperUpdate);
    }
  }
  attachResetControl(blades, spec, holder, key, onChange);

  return result;
}

export function buildGlobalDirectorControls(
  folder: { addBinding: (target: any, prop: any, options?: any) => any },
  director = getGlobalDirector(),
  onHelperUpdate?: (info: ControlHelperDescriptor | null) => void,
) {
  const initial = director.getSettings();
  const settings = {
    ...initial,
    customTint: Boolean(initial.customTint),
    customShadowTint: initial.customShadowTint ?? DEFAULT_CUSTOM_SHADOW_TINT,
    customHighlightTint: initial.customHighlightTint ?? DEFAULT_CUSTOM_HIGHLIGHT_TINT,
  };
  let syncing = false;
  let experienceModeBinding: any;
  let cameraModeBinding: any;
  let cameraIntensityBinding: any;
  let colorMoodBinding: any;
  let colorIntensityBinding: any;
  let customTintBinding: any;
  let customShadowTintBinding: any;
  let customHighlightTintBinding: any;
  let triggerCadenceBinding: any;

  const updateCustomTintVisibility = () => {
    const show = Boolean(settings.customTint);
    if (customShadowTintBinding) customShadowTintBinding.hidden = !show;
    if (customHighlightTintBinding) customHighlightTintBinding.hidden = !show;
  };

  const syncFromDirector = () => {
    if (syncing) return;
    syncing = true;
    try {
      const next = director.getSettings();
      Object.assign(settings, next, {
        customTint: Boolean(next.customTint),
        customShadowTint: next.customShadowTint ?? DEFAULT_CUSTOM_SHADOW_TINT,
        customHighlightTint: next.customHighlightTint ?? DEFAULT_CUSTOM_HIGHLIGHT_TINT,
      });
      experienceModeBinding?.refresh?.();
      cameraModeBinding?.refresh?.();
      cameraIntensityBinding?.refresh?.();
      colorMoodBinding?.refresh?.();
      colorIntensityBinding?.refresh?.();
      customTintBinding?.refresh?.();
      customShadowTintBinding?.refresh?.();
      customHighlightTintBinding?.refresh?.();
      updateCustomTintVisibility();
      triggerCadenceBinding?.refresh?.();
    } finally {
      syncing = false;
    }
  };

  experienceModeBinding = folder.addBinding(settings, 'experienceMode', {
    label: 'Experience mode',
    options: {
      'Cinematic': 'cinematic',
      'Calm': 'calm',
      'Minimal': 'minimal',
      'Color Walk': 'colorWalk',
      'Custom': 'custom',
    },
  });
  experienceModeBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.setExperienceMode(ev.value as ExperienceMode);
    syncFromDirector();
  });
  attachControlHelper(
    experienceModeBinding,
    {
      label: 'Experience mode',
      description: 'A ready-made camera and colour setup. Cinematic moves and recolours, Calm is gentle, Minimal leaves the preset alone, Color Walk keeps still and shifts colour. Custom is your own mix.',
    },
    onHelperUpdate,
  );

  cameraModeBinding = folder.addBinding(settings, 'cameraMode', {
    label: 'Camera motion',
    options: {
      'Auto': 'auto',
      'Crane sway': 'craneSway',
      'Dutch roll': 'dutchRoll',
      'Push in and out': 'breathingPush',
      'Horizon tilt': 'horizonTilt',
      'Still anchor': 'stillAnchor',
      'Off': 'off',
    },
  });
  cameraModeBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ cameraMode: ev.value as CameraMode });
    syncFromDirector();
  });
  attachControlHelper(
    cameraModeBinding,
    {
      label: 'Camera motion',
      description: 'How the camera moves over the picture. Auto picks a move that suits each preset.',
    },
    onHelperUpdate,
  );

  cameraIntensityBinding = folder.addBinding(settings, 'cameraIntensity', {
    label: 'Camera intensity',
    min: 0,
    max: 1,
    step: 0.05,
  });
  cameraIntensityBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ cameraIntensity: Number(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    cameraIntensityBinding,
    {
      label: 'Camera intensity',
      description: 'How far the camera moves. 0 keeps it still.',
    },
    onHelperUpdate,
  );

  colorMoodBinding = folder.addBinding(settings, 'colorMood', {
    label: 'Color mood',
    options: {
      'Auto-cycle': 'auto',
      'Native (preset)': 'native',
      'Cyberpunk': 'cyberpunk',
      'Ember': 'ember',
      'Bioluminescent': 'biolum',
      'Vapor': 'vapor',
      'Prismatic': 'prismatic',
      'Monochrome Noir': 'noir',
      'Acid Neon': 'acid',
      'Nordic Aurora': 'aurora',
      'Deep Sunset': 'sunset',
    },
  });
  colorMoodBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ colorMood: ev.value as ColorMood });
    syncFromDirector();
  });
  attachControlHelper(
    colorMoodBinding,
    {
      label: 'Color mood',
      description: 'Tints the picture with a colour palette. Auto changes palettes over time; Native keeps the preset colours.',
    },
    onHelperUpdate,
  );

  colorIntensityBinding = folder.addBinding(settings, 'colorIntensity', {
    label: 'Color intensity',
    min: 0,
    max: 1,
    step: 0.05,
  });
  colorIntensityBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ colorIntensity: Number(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    colorIntensityBinding,
    {
      label: 'Color intensity',
      description: 'How strongly the palette tints the picture. 0 leaves the preset colours alone.',
    },
    onHelperUpdate,
  );

  customTintBinding = folder.addBinding(settings, 'customTint', {
    label: 'Custom tint',
  });
  customTintBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ customTint: Boolean(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    customTintBinding,
    {
      label: 'Custom tint',
      description: 'Use your own two colours instead of the palette: one for dark areas, one for bright areas.',
    },
    onHelperUpdate,
  );

  customShadowTintBinding = folder.addBinding(settings, 'customShadowTint', {
    label: 'Shadow tint',
    view: 'color',
  });
  customShadowTintBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ customShadowTint: String(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    customShadowTintBinding,
    {
      label: 'Shadow tint',
      description: 'The colour for dark areas when Custom tint is on.',
    },
    onHelperUpdate,
  );

  customHighlightTintBinding = folder.addBinding(settings, 'customHighlightTint', {
    label: 'Highlight tint',
    view: 'color',
  });
  customHighlightTintBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ customHighlightTint: String(ev.value) });
    syncFromDirector();
  });
  attachControlHelper(
    customHighlightTintBinding,
    {
      label: 'Highlight tint',
      description: 'The colour for bright areas when Custom tint is on.',
    },
    onHelperUpdate,
  );

  updateCustomTintVisibility();

  triggerCadenceBinding = folder.addBinding(settings, 'triggerCadence', {
    label: 'Transition trigger',
    options: {
      'Song section (35s+)': 'section',
      'Every 32 beats': 'beats32',
      'Every 64 beats': 'beats64',
      'Every 128 beats': 'beats128',
      'Timer (45s)': 'timer45',
    },
  });
  triggerCadenceBinding?.on?.('change', (ev: { value: any }) => {
    if (syncing) return;
    director.updateSettings({ triggerCadence: ev.value as TriggerCadence });
    syncFromDirector();
  });
  attachControlHelper(
    triggerCadenceBinding,
    {
      label: 'Transition trigger',
      description: 'When Camera or Color mood is Auto, how often they change: at a new song section, every 32, 64 or 128 beats, or every 45 seconds. This does not switch presets.',
    },
    onHelperUpdate,
  );

  const unsubscribe =
    typeof director.subscribeExperienceChange === 'function'
      ? director.subscribeExperienceChange(() => {
          syncFromDirector();
        })
      : () => {};

  return {
    experienceModeBinding,
    cameraModeBinding,
    cameraIntensityBinding,
    colorMoodBinding,
    colorIntensityBinding,
    customTintBinding,
    customShadowTintBinding,
    customHighlightTintBinding,
    triggerCadenceBinding,
    unsubscribe,
  };
}
