// Preset browser for the main screen (Slice 21.4). Grid of presets grouped by theme, with a favourite toggle and a
// cost badge (Light / Medium / Heavy). Favourites are the "favourite" preset tag, the same tag the Studio and the
// auto-cycle use. Grouping and badge logic is pure so it can be unit-tested; the DOM part only builds elements.
import { PRESET_THEMES, type Preset, type PresetTheme } from '../presets/format';
import { presetCost, type CostLevel } from '../presets/cost';

export const FAVOURITE_TAG = 'favourite';
export const UNTHEMED_KEY = 'unthemed' as const;
export type ThemeKey = PresetTheme | typeof UNTHEMED_KEY;

export interface BrowserPreset {
  id: string;
  name: string;
  theme?: PresetTheme;
  tags: readonly string[];
  cost: CostLevel;
}

export interface ThemeGroup {
  key: ThemeKey;
  label: string;
  entries: BrowserPreset[];
}

export interface CostBadge {
  level: CostLevel;
  label: string;
  className: string;
}

/** Turns a stored preset into the browser's view model. The cost comes from the settings, never from the file. */
export function toBrowserPreset(id: string, preset: Pick<Preset, 'name' | 'theme' | 'tags' | 'feedback' | 'post' | 'layers'>): BrowserPreset {
  return {
    id,
    name: preset.name,
    ...(preset.theme ? { theme: preset.theme } : {}),
    tags: preset.tags ?? [],
    cost: presetCost(preset).level,
  };
}

export function isFavourite(entry: Pick<BrowserPreset, 'tags'>): boolean {
  return entry.tags.includes(FAVOURITE_TAG);
}

/** Returns a new tag list with the favourite tag added or removed. Other tags keep their order. */
export function withFavourite(tags: readonly string[], on: boolean): string[] {
  const rest = tags.filter((t) => t !== FAVOURITE_TAG);
  return on ? [...rest, FAVOURITE_TAG] : rest;
}

const COST_LABELS: Record<CostLevel, string> = { light: 'Light', medium: 'Medium', heavy: 'Heavy' };

export function costBadge(level: CostLevel): CostBadge {
  return { level, label: COST_LABELS[level], className: `preset-cost preset-cost-${level}` };
}

export function themeLabel(key: ThemeKey): string {
  if (key === UNTHEMED_KEY) return 'Unthemed';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Groups presets by theme in the order of PRESET_THEMES, with unthemed presets last. Empty groups are left out.
 * `filter` keeps only one theme ("all" keeps everything). Entries keep their input order inside a group.
 */
export function groupByTheme(entries: readonly BrowserPreset[], filter: ThemeKey | 'all' = 'all'): ThemeGroup[] {
  const order: ThemeKey[] = [...PRESET_THEMES, UNTHEMED_KEY];
  const groups: ThemeGroup[] = [];
  for (const key of order) {
    if (filter !== 'all' && filter !== key) continue;
    const matched = entries.filter((e) => (e.theme ?? UNTHEMED_KEY) === key);
    if (matched.length === 0) continue;
    groups.push({ key, label: themeLabel(key), entries: matched });
  }
  return groups;
}

export interface ThemeOption {
  value: ThemeKey | 'all';
  label: string;
  count: number;
}

/** Options for the theme filter: "All", then each theme that has at least one preset. */
export function themeOptions(entries: readonly BrowserPreset[]): ThemeOption[] {
  const options: ThemeOption[] = [{ value: 'all', label: 'All themes', count: entries.length }];
  for (const group of groupByTheme(entries)) {
    options.push({ value: group.key, label: group.label, count: group.entries.length });
  }
  return options;
}

export function favouriteCount(entries: readonly BrowserPreset[]): number {
  return entries.filter(isFavourite).length;
}

export interface PresetBrowserHandlers {
  onSelect?: (id: string) => void;
  onFavouriteChange?: (id: string, favourite: boolean) => void;
}

export interface PresetBrowserHandle {
  /** Replaces the list shown. Keeps the current theme filter when it still has presets. */
  setEntries(entries: BrowserPreset[]): void;
  /** Returns the preset list currently shown (after any favourite toggles). */
  getEntries(): BrowserPreset[];
  destroy(): void;
}

/** Builds the browser inside `root`. Text is set with textContent, never innerHTML. */
export function mountPresetBrowser(root: HTMLElement, handlers: PresetBrowserHandlers = {}): PresetBrowserHandle {
  let entries: BrowserPreset[] = [];
  let filter: ThemeKey | 'all' = 'all';
  root.classList.add('preset-browser');

  const toolbar = document.createElement('div');
  toolbar.className = 'preset-browser-toolbar';
  const count = document.createElement('span');
  count.className = 'preset-browser-count';
  const select = document.createElement('select');
  select.className = 'preset-browser-theme';
  select.setAttribute('aria-label', 'Filter presets by theme');
  toolbar.append(count, select);

  const list = document.createElement('div');
  list.className = 'preset-browser-list';
  root.replaceChildren(toolbar, list);

  const renderCard = (entry: BrowserPreset): HTMLElement => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.dataset.presetId = entry.id;

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'preset-card-pick';
    pick.textContent = entry.name;
    pick.addEventListener('click', () => handlers.onSelect?.(entry.id));

    const meta = document.createElement('div');
    meta.className = 'preset-card-meta';
    const badge = costBadge(entry.cost);
    const badgeEl = document.createElement('span');
    badgeEl.className = badge.className;
    badgeEl.textContent = badge.label;
    meta.append(badgeEl);

    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'preset-card-fav';
    const on = isFavourite(entry);
    fav.setAttribute('aria-pressed', String(on));
    fav.setAttribute('aria-label', `${on ? 'Remove' : 'Add'} ${entry.name} ${on ? 'from' : 'to'} favourites`);
    fav.textContent = on ? '★' : '☆';
    fav.addEventListener('click', () => {
      const next = !isFavourite(entry);
      entry.tags = withFavourite(entry.tags, next);
      handlers.onFavouriteChange?.(entry.id, next);
      render();
    });

    card.append(pick, meta, fav);
    return card;
  };

  const render = (): void => {
    const groups = groupByTheme(entries, filter);
    const options = themeOptions(entries);
    select.replaceChildren(
      ...options.map((o) => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = `${o.label} (${o.count})`;
        return opt;
      }),
    );
    select.value = options.some((o) => o.value === filter) ? filter : 'all';
    filter = select.value as ThemeKey | 'all';
    count.textContent = `${entries.length} presets, ${favouriteCount(entries)} favourite`;

    const sections = groups.map((group) => {
      const section = document.createElement('section');
      section.className = 'preset-group';
      section.dataset.theme = group.key;
      const heading = document.createElement('h3');
      heading.className = 'preset-group-title';
      heading.textContent = group.label;
      const grid = document.createElement('div');
      grid.className = 'preset-grid';
      grid.append(...group.entries.map(renderCard));
      section.append(heading, grid);
      return section;
    });
    list.replaceChildren(...sections);
  };

  select.addEventListener('change', () => {
    filter = select.value as ThemeKey | 'all';
    render();
  });

  return {
    setEntries(next) {
      entries = next;
      render();
    },
    getEntries() {
      return entries;
    },
    destroy() {
      root.replaceChildren();
      root.classList.remove('preset-browser');
    },
  };
}
