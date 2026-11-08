// Preset Studio panel. Built with Tweakpane (MIT), which is loaded only here; the renderer does not use it.
// Sections: preset bar (switch, save, save as, duplicate, delete, export, import, undo, redo),
// vary (randomise, mutate, lock per layer), layer stack (select, enable, add, remove, reorder),
// settings for every enabled layer (built from the schema), and a frame-time readout.
// Value edits go straight to the live layers. Layer-list edits rebuild the scene.
import { Pane, type ButtonApi, type FolderApi } from 'tweakpane';
import { LAYER_FACTORIES, applyValues, valuesOf } from '../presets/loader';
import { LAYER_SPECS } from '../presets/layerSchemas';
import { SCHEMAS } from '../presets/builtin';
import { AUDIO_SOURCES, BLEND_MODES, LFO_RATE_DEFAULT, LFO_RATE_MAX, LFO_RATE_MIN, MORPH_RATE_DEFAULT, MORPH_RATE_MAX, MORPH_RATE_MIN, TRANSITION_STYLES, type LayerEntry, type Preset, type Settings, type Setting } from '../presets/format';
import { mutateSettings, randomiseSettings } from '../presets/variation';
import type { PresetSession } from '../presets/session';
import { attachSwipeDismiss } from '../ui/controls';
import type { ParamSpec, ParamValue } from '../presets/schema';
import { showToast } from '../ui/toast';

export interface StudioOptions {
  session: PresetSession;
  /** Make a preset the one on screen (main.ts keeps the key handling and the toast). */
  switchTo: (id: string) => void;
  /** Latest frame time in ms, for the readout. */
  frameMs?: () => number;
  /** Live link value (0..1) for a key `${presetId}L${layerIndexAmongEnabled}.${name}` or `${presetId}F.${name}`. */
  linkMeter?: (key: string) => number | undefined;
}

/** Frame budget at 60 fps. The readout turns into a warning above this. */
const FRAME_BUDGET_MS = 16.7;

/** A first Delete tap stays armed for this long. A second tap inside the window deletes. */
export const DELETE_CONFIRM_MS = 3000;
const DELETE_LABEL = 'Delete';
const DELETE_ARMED_LABEL = 'Tap again to delete';

/** Text for the Delete live region: the armed prompt while armed, empty otherwise (slice 11.4). */
export function deleteAnnouncement(armed: boolean): string {
  return armed ? DELETE_ARMED_LABEL : '';
}

/** Trim a typed preset name. Empty or whitespace-only names are rejected with a short message. */
export function validatePresetName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.trim();
  if (name === '') return { ok: false, message: 'Enter a name first.' };
  return { ok: true, name };
}

/**
 * Two-tap Delete state. With no arm (`armedAt` null) a tap arms and returns the time it armed.
 * A tap inside `windowMs` of the arm confirms and returns to unarmed.
 */
export function nextDeleteTap(armedAt: number | null, now: number, windowMs: number = DELETE_CONFIRM_MS): { confirm: boolean; armedAt: number | null } {
  if (armedAt !== null && now - armedAt >= 0 && now - armedAt < windowMs) return { confirm: true, armedAt: null };
  return { confirm: false, armedAt: now };
}

export class Studio {
  private pane: Pane | null = null;
  private id = '';
  private selected = 0;
  private addType = 'tunnel';
  /** Layers (by index in the preset) that randomise and mutate skip. Reset when the layer list changes. */
  private locked = new Set<number>();
  private monitor = { ms: 0 };
  private linkTarget = '';
  private linkMonitor = { value: 0 };
  /** Delete two-tap state: when the first tap armed it, its timer, and the button it lives on. */
  private deleteArmedAt: number | null = null;
  private deleteTimer: number | undefined;
  private deleteBtn: ButtonApi | null = null;
  /** Polite live region that announces the "Tap again" state of Delete. */
  private readonly deleteLive: HTMLElement = document.createElement('div');
  /** The in-panel "Save as" name field, when open. */
  private saveAsField: HTMLElement | null = null;

  /** Where the Tweakpane pane is built (the header with Close stays in the container). */
  private readonly body: HTMLElement;
  /** The element that had focus before the panel opened; focus returns to it on close. */
  private opener: HTMLElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: StudioOptions,
  ) {
    this.body = container.querySelector<HTMLElement>('.studio-body') ?? container;
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'false');
    container.setAttribute('aria-label', 'Studio');
    this.deleteLive.setAttribute('role', 'status');
    this.deleteLive.setAttribute('aria-live', 'polite');
    this.deleteLive.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
    container.append(this.deleteLive);
    container.querySelector<HTMLButtonElement>('#studio-close')?.addEventListener('click', () => this.setVisible(false));
    // Swipe down on a phone sheet closes Studio (slice 11.6). Same path as the Close button, so focus returns.
    attachSwipeDismiss(container, () => this.setVisible(false));
    // Any pointer or key action outside the Delete button disarms a pending Delete.
    const disarmOnOther = (ev: Event) => {
      if (this.deleteArmedAt === null) return;
      if (this.deleteBtn?.element.contains(ev.target as Node)) return;
      this.disarmDelete();
    };
    this.body.addEventListener('pointerdown', disarmOnOther, true);
    this.body.addEventListener('keydown', disarmOnOther, true);
    window.setInterval(() => {
      if (!this.visible || !this.pane) return;
      this.monitor.ms = this.opts.frameMs?.() ?? 0;
      this.pane.refresh();
    }, 500);
  }

  /** Show or hide the panel. Opening moves focus into it (after bind); closing returns focus to the opener. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    if (visible) {
      this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.container.hidden = false;
      requestAnimationFrame(() => this.focusFirst());
    } else {
      this.container.hidden = true;
      const back = this.opener;
      this.opener = null;
      if (back?.isConnected) back.focus();
    }
  }

  private focusFirst(): void {
    if (!this.visible) return;
    const first = this.body.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled), select, textarea');
    (first ?? this.container.querySelector<HTMLElement>('#studio-close'))?.focus();
  }

  get visible(): boolean {
    return !this.container.hidden;
  }

  /** (Re)build the panel for preset `id`. Call after every switch or structure change. */
  bind(id: string): void {
    this.id = id;
    this.disarmDelete();
    this.deleteBtn = null;
    this.pane?.dispose();
    this.body.replaceChildren();
    this.saveAsField = null;
    const pane = new Pane({ container: this.body, title: 'Preset Studio' });
    this.pane = pane;
    const session = this.opts.session;
    const entry = session.get(id);
    if (!entry) return;
    const preset = entry.preset;

    // --- Preset bar -----------------------------------------------------------------
    const ids = Object.fromEntries(session.list().map((e) => [e.preset.name + (e.builtin ? '' : ' (yours)'), e.id]));
    const pick = { id };
    pane.addBinding(pick, 'id', { label: 'Preset', options: ids }).on('change', (ev) => this.opts.switchTo(String(ev.value)));
    pane.addBinding(preset as unknown as Record<string, unknown>, 'name', { label: 'Name' });
    const dirty = session.isDirty(id) ? ' · unsaved changes' : '';
    // Tags for the auto-cycle (T2): "favourite" and "skip".
    const tagHolder = { favourite: preset.tags.includes('favourite'), skip: preset.tags.includes('skip') };
    const setTag = (tag: string, on: boolean) => {
      preset.tags = preset.tags.filter((t) => t !== tag);
      if (on) preset.tags.push(tag);
      session.commit(id);
    };
    pane.addBinding(tagHolder, 'favourite', { label: 'Favourite (auto-cycle)' }).on('change', (ev) => setTag('favourite', Boolean(ev.value)));
    pane.addBinding(tagHolder, 'skip', { label: 'Skip in auto-cycle' }).on('change', (ev) => setTag('skip', Boolean(ev.value)));
    // Transition into this preset (T1): style and time. Applied the next time the preset is shown.
    pane.addBinding(preset.transition as unknown as Record<string, unknown>, 'style', {
      label: 'Transition style',
      options: Object.fromEntries(TRANSITION_STYLES.map((t) => [t, t])),
    }).on('change', () => session.commit(id));
    pane.addBinding(preset.transition as unknown as Record<string, unknown>, 'seconds', { label: 'Transition seconds', min: 0.3, max: 10, step: 0.05 }).on('change', () => session.commit(id));
    // Action buttons share one grid wrapper (slice 10.2). Each button's element is collected, then moved into the wrapper below.
    const tiles: HTMLElement[] = [];
    const tile = <T extends ButtonApi>(btn: T): T => {
      tiles.push(btn.element);
      return btn;
    };
    tile(pane.addButton({ title: `Save${dirty}` })).on('click', () => this.run(() => session.save(id), 'Saved'));
    tile(pane.addButton({ title: 'Save as…' })).on('click', () => this.openSaveAsField(id, `${preset.name} copy`));
    tile(pane.addButton({ title: 'Duplicate' })).on('click', () =>
      this.run(() => this.opts.switchTo(session.saveAs(id, `${preset.name} copy`)), 'Duplicated'),
    );
    if (!entry.builtin) {
      const del = tile(pane.addButton({ title: DELETE_LABEL }));
      this.deleteBtn = del;
      del.on('click', () => this.onDeleteTap(del, id));
    }
    tile(pane.addButton({ title: 'Export .json' })).on('click', () => this.exportFile(id));
    tile(pane.addButton({ title: 'Import .json…' })).on('click', () => this.importFile());
    const undo = tile(pane.addButton({ title: 'Undo' }));
    undo.disabled = !session.canUndo(id);
    undo.on('click', () => this.run(() => {
      session.undo(id);
    }, 'Undone'));
    const redo = tile(pane.addButton({ title: 'Redo' }));
    redo.disabled = !session.canRedo(id);
    redo.on('click', () => this.run(() => {
      session.redo(id);
    }, 'Redone'));
    const tileGrid = document.createElement('div');
    tileGrid.className = 'studio-tiles';
    tiles[0]?.before(tileGrid);
    tileGrid.append(...tiles);

    // --- Vary -----------------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    pane.addButton({ title: 'Randomise (within safe ranges)' }).on('click', () => this.vary('random'));
    pane.addButton({ title: 'Mutate (±10%)' }).on('click', () => this.vary('mutate'));

    // --- Layer stack ----------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    this.selected = preset.layers.length === 0 ? 0 : Math.min(this.selected, preset.layers.length - 1);
    if (preset.layers.length > 0) {
      const layerOptions = Object.fromEntries(preset.layers.map((l, i) => [`${i + 1}. ${l.type}${l.enabled ? '' : ' (off)'}`, i]));
      const sel = { selected: this.selected };
      pane.addBinding(sel, 'selected', { label: 'Layer', options: layerOptions }).on('change', (ev) => {
        this.selected = Number(ev.value);
        this.bind(id);
      });
      const layer = preset.layers[this.selected]!;
      pane.addBinding(layer as unknown as Record<string, unknown>, 'enabled', { label: 'Layer on' }).on('change', () => this.structure());
      const lock = { locked: this.locked.has(this.selected) };
      pane.addBinding(lock, 'locked', { label: 'Keep when randomising' }).on('change', (ev) => {
        if (ev.value) this.locked.add(this.selected);
        else this.locked.delete(this.selected);
      });
      pane.addBinding(layer as unknown as Record<string, unknown>, 'opacity', { label: 'Opacity (not drawn yet)', min: 0, max: 1, step: 0.01 });
      pane.addBinding(layer as unknown as Record<string, unknown>, 'blend', {
        label: 'Blend (not drawn yet)',
        options: Object.fromEntries(BLEND_MODES.map((b) => [b, b])),
      });
      pane.addButton({ title: 'Move layer up' }).on('click', () => this.move(-1));
      pane.addButton({ title: 'Move layer down' }).on('click', () => this.move(1));
      pane.addButton({ title: 'Remove layer' }).on('click', () => {
        preset.layers.splice(this.selected, 1);
        this.structure();
      });
    }
    const typeHolder = { type: this.addType };
    const typeOptions = Object.fromEntries(Object.keys(LAYER_FACTORIES).map((t) => [t, t]));
    pane.addBinding(typeHolder, 'type', { label: 'Add layer', options: typeOptions }).on('change', (ev) => {
      this.addType = String(ev.value);
    });
    pane.addButton({ title: 'Add this layer' }).on('click', () => {
      preset.layers.push(defaultLayer(this.addType));
      this.selected = preset.layers.length - 1;
      this.structure();
    });

    // --- Settings -------------------------------------------------------------------
    // Settings for every enabled layer. Live layers are matched by their order among the enabled ones.
    let live = 0;
    for (const layerEntry of preset.layers) {
      if (!layerEntry.enabled) continue;
      const k = live++;
      this.bindSection(pane, layerEntry.type, LAYER_SPECS[layerEntry.type] ?? [], layerEntry.params, () => {
        const current = session.sceneOf(id).layers[k];
        if (current) applyValues(current, valuesOf(layerEntry.params));
      });
    }
    this.bindSection(pane, 'Feedback', SCHEMAS.feedback, preset.feedback, () => session.sceneOf(id).setFeedback(valuesOf(preset.feedback)));
    this.bindSection(pane, 'Post', SCHEMAS.post, preset.post, () => session.refreshPost(id));

    // --- Audio link (slice E2) --------------------------------------------------------
    this.bindLinkEditor(pane, id, preset);
    this.bindMorphEditor(pane, id, preset);

    // --- Frame time -----------------------------------------------------------------
    pane.addBlade({ view: 'separator' });
    this.monitor.ms = this.opts.frameMs?.() ?? 0;
    pane.addBinding(this.monitor, 'ms', {
      label: `Frame time ms (60 fps ≤ ${FRAME_BUDGET_MS})`,
      readonly: true,
      format: (v: number) => v.toFixed(1),
    });
  }

  /** Pick one numeric setting, then add, edit or remove its audio link. */
  private bindLinkEditor(pane: Pane, id: string, preset: Preset): void {
    const targets = linkTargets(preset);
    if (targets.length === 0) return;
    pane.addBlade({ view: 'separator' });
    if (!targets.some((t) => t.key === this.linkTarget)) this.linkTarget = targets[0]!.key;
    const pick = { key: this.linkTarget };
    pane.addBinding(pick, 'key', {
      label: 'Link a setting',
      options: Object.fromEntries(targets.map((t) => [t.label, t.key])),
    }).on('change', (ev) => {
      this.linkTarget = String(ev.value);
      this.bind(id);
    });
    const target = targets.find((t) => t.key === this.linkTarget)!;
    const setting = target.setting;
    const session = this.opts.session;
    if (!setting.link) {
      pane.addButton({ title: 'Add audio link' }).on('click', () => {
        session.commit(id);
        setting.link = { source: 'bass', amount: 0.2, smooth: 0.2 };
        this.bind(id);
      });
      return;
    }
    const link = setting.link;
    const onEdit = () => session.commit(id);
    pane.addBinding(link as unknown as Record<string, unknown>, 'source', {
      label: 'Source',
      options: Object.fromEntries(AUDIO_SOURCES.map((s) => [s, s])),
    }).on('change', onEdit);
    pane.addBinding(link as unknown as Record<string, unknown>, 'amount', { label: 'Amount (share of range)', min: -1, max: 1, step: 0.01 }).on('change', onEdit);
    pane.addBinding(link as unknown as Record<string, unknown>, 'smooth', { label: 'Smoothing', min: 0, max: 1, step: 0.01 }).on('change', onEdit);
    if (link.source.startsWith('lfo')) {
      // LFO rate (slice: adjustable LFOs). Blank means the 0.5 Hz default.
      const rateBox = link as unknown as { rate?: number };
      if (rateBox.rate === undefined) rateBox.rate = LFO_RATE_DEFAULT;
      pane.addBinding(rateBox, 'rate', { label: 'LFO rate (Hz)', min: LFO_RATE_MIN, max: LFO_RATE_MAX, step: 0.05 }).on('change', onEdit);
    }
    // The runner's keys are `${presetId}${L|F}…`, so the preset id goes in front.
    this.linkMonitor.value = target.meterKey ? this.opts.linkMeter?.(`${id}${target.meterKey}`) ?? 0 : 0;
    pane.addBinding(this.linkMonitor, 'value', { label: 'Source now (0–1)', readonly: true, format: (v: number) => v.toFixed(2) });
    pane.addButton({ title: 'Remove audio link' }).on('click', () => {
      session.commit(id);
      delete (setting as Setting).link;
      this.bind(id);
    });
  }

  /** Morph the setting picked in the link editor: it swings between its value and a second value (slice E-c). */
  private bindMorphEditor(pane: Pane, id: string, preset: Preset): void {
    const target = linkTargets(preset).find((t) => t.key === this.linkTarget);
    if (!target || (target.spec.type !== 'float' && target.spec.type !== 'int')) return;
    const { spec, setting } = target;
    const session = this.opts.session;
    const onEdit = () => session.commit(id);
    if (!setting.morph) {
      pane.addButton({ title: 'Add morph (swing to a second value)' }).on('click', () => {
        session.commit(id);
        setting.morph = { to: morphTargetFor(spec, setting.value), rate: MORPH_RATE_DEFAULT };
        this.bind(id);
      });
      return;
    }
    const morph = setting.morph;
    pane.addBinding(morph as unknown as Record<string, unknown>, 'to', {
      label: 'Morph to',
      min: spec.min,
      max: spec.max,
      step: spec.step,
    }).on('change', onEdit);
    pane.addBinding(morph as unknown as Record<string, unknown>, 'rate', {
      label: 'Morph rate (cycles/s)',
      min: MORPH_RATE_MIN,
      max: MORPH_RATE_MAX,
      step: 0.01,
    }).on('change', onEdit);
    pane.addButton({ title: 'Remove morph' }).on('click', () => {
      session.commit(id);
      delete (setting as Setting).morph;
      this.bind(id);
    });
  }

  private bindSection(pane: Pane, title: string, specs: readonly ParamSpec[], settings: Settings, apply: () => void): void {
    if (specs.length === 0) return;
    const sectionTitle = title.charAt(0).toUpperCase() + title.slice(1);
    const sectionFolder = pane.addFolder({ title: sectionTitle, expanded: false });
    const holder: Record<string, ParamValue> = valuesOf(settings);
    const groups = new Map<string, ParamSpec[]>();
    for (const spec of specs) {
      const list = groups.get(spec.group);
      if (list) {
        list.push(spec);
      } else {
        groups.set(spec.group, [spec]);
      }
    }
    for (const [groupName, groupSpecs] of groups) {
      const target = groupName ? sectionFolder.addFolder({ title: groupName, expanded: false }) : sectionFolder;
      for (const spec of groupSpecs) {
        const push = () => {
          this.opts.session.commit(this.id);
          const setting = settings[spec.name];
          if (setting) setting.value = holder[spec.name]!;
          apply();
        };
        bindSpec(target, spec.label, spec, holder, push);
      }
    }
  }

  /** Randomise or mutate every unlocked layer (and feedback/post), as one undo step. */
  private vary(kind: 'random' | 'mutate'): void {
    const session = this.opts.session;
    const entry = session.get(this.id);
    if (!entry) return;
    const rng = Math.random;
    entry.preset.layers.forEach((layer, i) => {
      if (this.locked.has(i)) return;
      const specs = LAYER_SPECS[layer.type] ?? [];
      layer.params = kind === 'random' ? randomiseSettings(layer.params, specs, rng) : mutateSettings(layer.params, specs, rng);
    });
    if (kind === 'random') {
      entry.preset.feedback = randomiseSettings(entry.preset.feedback, SCHEMAS.feedback, rng);
      entry.preset.post = randomiseSettings(entry.preset.post, SCHEMAS.post, rng);
    } else {
      entry.preset.feedback = mutateSettings(entry.preset.feedback, SCHEMAS.feedback, rng);
      entry.preset.post = mutateSettings(entry.preset.post, SCHEMAS.post, rng);
    }
    session.commit(this.id, Date.now(), true);
    session.rebuild(this.id);
    this.bind(this.id);
    showToast(kind === 'random' ? 'Randomised (undo to go back)' : 'Mutated (undo to go back)');
  }

  private move(delta: -1 | 1): void {
    const layers = this.opts.session.get(this.id)!.preset.layers;
    const target = this.selected + delta;
    if (target < 0 || target >= layers.length) return;
    [layers[this.selected], layers[target]] = [layers[target]!, layers[this.selected]!];
    this.selected = target;
    this.structure();
  }

  /** After a layer-list change: record for undo, rebuild the scene from the working copy, redraw. */
  private structure(): void {
    this.opts.session.commit(this.id);
    this.locked.clear();
    this.opts.session.rebuild(this.id);
    this.bind(this.id);
  }

  /** Show the in-panel name field for Save as. OK saves under the typed name; Cancel or Escape changes nothing. */
  private openSaveAsField(id: string, defaultName: string): void {
    this.closeSaveAsField();
    const session = this.opts.session;
    const field = document.createElement('div');
    field.style.display = 'flex';
    field.style.flexWrap = 'wrap';
    field.style.gap = '6px';
    field.style.padding = '6px';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultName;
    input.setAttribute('aria-label', 'Name for the new preset');
    const msg = document.createElement('span');
    msg.setAttribute('role', 'alert');
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const submit = () => {
      const check = validatePresetName(input.value);
      if (!check.ok) {
        msg.textContent = check.message;
        input.focus();
        return;
      }
      this.closeSaveAsField();
      this.run(() => this.opts.switchTo(session.saveAs(id, check.name)), 'Saved as new preset');
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.closeSaveAsField();
      }
    });
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', () => this.closeSaveAsField());
    field.append(input, ok, cancel, msg);
    this.body.prepend(field);
    this.saveAsField = field;
    input.focus();
    input.select();
  }

  private closeSaveAsField(): void {
    this.saveAsField?.remove();
    this.saveAsField = null;
  }

  /** First tap arms Delete for DELETE_CONFIRM_MS. A tap inside that window deletes. */
  private onDeleteTap(btn: ButtonApi, id: string): void {
    const step = nextDeleteTap(this.deleteArmedAt, Date.now());
    this.disarmDelete();
    if (step.confirm) {
      this.run(() => {
        this.opts.session.remove(id);
        this.opts.switchTo('crown');
      }, 'Deleted');
      return;
    }
    this.deleteArmedAt = step.armedAt;
    this.deleteBtn = btn;
    btn.title = DELETE_ARMED_LABEL;
    this.deleteLive.textContent = deleteAnnouncement(true);
    this.deleteTimer = window.setTimeout(() => this.disarmDelete(), DELETE_CONFIRM_MS);
  }

  /** Return Delete to its idle state and clear the timer. */
  private disarmDelete(): void {
    if (this.deleteTimer !== undefined) window.clearTimeout(this.deleteTimer);
    this.deleteTimer = undefined;
    this.deleteArmedAt = null;
    if (this.deleteBtn) this.deleteBtn.title = DELETE_LABEL;
    this.deleteLive.textContent = deleteAnnouncement(false);
  }

  private run(action: () => void, doneMessage: string): void {
    try {
      action();
      showToast(doneMessage);
      const stillThere = this.opts.session.get(this.id) ? this.id : 'crown';
      this.bind(stillThere);
    } catch (err) {
      showToast((err as Error).message);
    }
  }

  private exportFile(id: string): void {
    const text = this.opts.session.exportJson(id);
    const name = (this.opts.session.get(id)?.preset.name ?? 'preset').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'preset'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private importFile(): void {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const { id, warnings } = this.opts.session.importJson(await file.text());
        showToast(warnings.length ? `Imported with ${warnings.length} fix(es)` : 'Imported');
        this.opts.switchTo(id);
      } catch (err) {
        showToast((err as Error).message);
      }
    });
    input.click();
  }
}

/** Every numeric setting that can take a link, with the key used in the Studio and the link meter key. */
function linkTargets(preset: Preset): { key: string; label: string; setting: Setting; meterKey: string; spec: ParamSpec }[] {
  const out: { key: string; label: string; setting: Setting; meterKey: string; spec: ParamSpec }[] = [];
  let live = 0;
  preset.layers.forEach((layer, i) => {
    const k = layer.enabled ? live++ : -1;
    for (const spec of LAYER_SPECS[layer.type] ?? []) {
      if (spec.type !== 'float' && spec.type !== 'int') continue;
      const setting = layer.params[spec.name];
      if (!setting) continue;
      out.push({
        key: `L${i}.${spec.name}`,
        label: `${i + 1}. ${layer.type} · ${spec.label}`,
        setting,
        meterKey: k >= 0 ? `L${k}.${spec.name}` : '',
        spec,
      });
    }
  });
  for (const spec of FEEDBACK_NUMBERS) {
    const setting = preset.feedback[spec.name];
    if (setting) out.push({ key: `F.${spec.name}`, label: `Feedback · ${spec.label}`, setting, meterKey: `F.${spec.name}`, spec });
  }
  return out;
}
const FEEDBACK_NUMBERS = SCHEMAS.feedback.filter((s) => s.type === 'float' || s.type === 'int');

/** Default morph end: a quarter of the range away from the value, on whichever side has room, kept in range. */
function morphTargetFor(spec: Extract<ParamSpec, { type: 'float' | 'int' }>, value: ParamValue): number {
  const base = typeof value === 'number' ? value : spec.default;
  const quarter = (spec.max - spec.min) * 0.25;
  let to = base + quarter;
  if (to > spec.max) to = base - quarter;
  to = Math.min(spec.max, Math.max(spec.min, to));
  return spec.type === 'int' ? Math.round(to) : to;
}

/** A new layer with the schema defaults, enabled, full opacity. */
function defaultLayer(type: string): LayerEntry {
  const params: Settings = {};
  for (const spec of LAYER_SPECS[type] ?? []) params[spec.name] = { value: spec.default };
  // New particle layers follow the scene by default (2026-11-06). Existing presets keep their stored value.
  if (type === 'particles') params.followScene = { value: true };
  return { type, enabled: true, opacity: 1, blend: 'add', params };
}

function bindSpec(pane: Pane | FolderApi, label: string, spec: ParamSpec, holder: Record<string, ParamValue>, onChange: () => void): void {
  const target = holder as Record<string, unknown>;
  switch (spec.type) {
    case 'float':
    case 'int':
      pane.addBinding(target, spec.name, { label, min: spec.min, max: spec.max, step: spec.step }).on('change', onChange);
      return;
    case 'bool':
      pane.addBinding(target, spec.name, { label }).on('change', onChange);
      return;
    case 'enum':
      pane.addBinding(target, spec.name, { label, options: Object.fromEntries(spec.options.map((o) => [o, o])) }).on('change', onChange);
      return;
    case 'colour':
      pane.addBinding(target, spec.name, { label, view: 'color' }).on('change', onChange);
      return;
  }
}
