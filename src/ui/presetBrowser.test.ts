import { describe, it, expect } from 'vitest';
import {
  FAVOURITE_TAG,
  UNTHEMED_KEY,
  costBadge,
  favouriteCount,
  groupByTheme,
  isFavourite,
  themeLabel,
  themeOptions,
  toBrowserPreset,
  withFavourite,
  type BrowserPreset,
} from './presetBrowser';
import type { PresetTheme } from '../presets/format';

const entry = (id: string, theme: PresetTheme | undefined, cost: BrowserPreset['cost'] = 'light', tags: string[] = []): BrowserPreset => ({
  id,
  name: `Preset ${id}`,
  ...(theme ? { theme } : {}),
  tags,
  cost,
});

describe('groupByTheme', () => {
  it('returns no groups for an empty list', () => {
    expect(groupByTheme([])).toEqual([]);
  });

  it('orders groups by PRESET_THEMES order, with unthemed last', () => {
    const groups = groupByTheme([
      entry('a', undefined),
      entry('b', 'waveform'),
      entry('c', 'fluid'),
      entry('d', 'fluid'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['fluid', 'waveform', UNTHEMED_KEY]);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['c', 'd']);
    expect(groups[2]?.label).toBe('Unthemed');
  });

  it('leaves out empty theme groups', () => {
    const groups = groupByTheme([entry('a', 'orbit')]);
    expect(groups.map((g) => g.key)).toEqual(['orbit']);
  });

  it('keeps only the filtered theme', () => {
    const entries = [entry('a', 'fluid'), entry('b', 'orbit'), entry('c', undefined)];
    expect(groupByTheme(entries, 'orbit').map((g) => g.key)).toEqual(['orbit']);
    expect(groupByTheme(entries, UNTHEMED_KEY).map((g) => g.entries[0]?.id)).toEqual(['c']);
    expect(groupByTheme(entries, 'hypnotic')).toEqual([]);
  });

  it('keeps input order inside a group', () => {
    const groups = groupByTheme([entry('z', 'sparkle'), entry('m', 'sparkle'), entry('a', 'sparkle')]);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(['z', 'm', 'a']);
  });
});

describe('themeOptions', () => {
  it('starts with All themes and counts each theme', () => {
    const options = themeOptions([entry('a', 'fluid'), entry('b', 'fluid'), entry('c', undefined)]);
    expect(options).toEqual([
      { value: 'all', label: 'All themes', count: 3 },
      { value: 'fluid', label: 'Fluid', count: 2 },
      { value: UNTHEMED_KEY, label: 'Unthemed', count: 1 },
    ]);
  });

  it('has only All when there are no presets', () => {
    expect(themeOptions([])).toEqual([{ value: 'all', label: 'All themes', count: 0 }]);
  });
});

describe('themeLabel', () => {
  it('capitalises the theme key', () => {
    expect(themeLabel('architecture')).toBe('Architecture');
  });
});

describe('costBadge', () => {
  it('labels each cost level', () => {
    expect(costBadge('light').label).toBe('Light');
    expect(costBadge('medium').label).toBe('Medium');
    expect(costBadge('heavy').label).toBe('Heavy');
  });

  it('gives each level its own class', () => {
    expect(costBadge('heavy')).toEqual({ level: 'heavy', label: 'Heavy', className: 'preset-cost preset-cost-heavy' });
  });
});

describe('favourites', () => {
  it('reads the favourite tag', () => {
    expect(isFavourite({ tags: [FAVOURITE_TAG] })).toBe(true);
    expect(isFavourite({ tags: ['skip'] })).toBe(false);
  });

  it('adds the favourite tag once and removes it cleanly', () => {
    expect(withFavourite(['skip'], true)).toEqual(['skip', FAVOURITE_TAG]);
    expect(withFavourite([FAVOURITE_TAG, 'skip'], true)).toEqual(['skip', FAVOURITE_TAG]);
    expect(withFavourite(['skip', FAVOURITE_TAG], false)).toEqual(['skip']);
  });

  it('does not mutate the input tags', () => {
    const tags = ['skip'];
    withFavourite(tags, true);
    expect(tags).toEqual(['skip']);
  });

  it('counts favourites', () => {
    expect(favouriteCount([entry('a', 'fluid', 'light', [FAVOURITE_TAG]), entry('b', 'fluid')])).toBe(1);
  });
});

describe('toBrowserPreset', () => {
  it('takes the name, theme and tags, and computes the cost from the settings', () => {
    const view = toBrowserPreset('p1', {
      name: 'Calm',
      theme: 'orbit',
      tags: [FAVOURITE_TAG],
      feedback: {},
      post: {},
      layers: [],
    });
    expect(view).toEqual({ id: 'p1', name: 'Calm', theme: 'orbit', tags: [FAVOURITE_TAG], cost: 'light' });
  });

  it('leaves theme out when the preset has none', () => {
    const view = toBrowserPreset('p2', { name: 'Plain', tags: [], feedback: {}, post: {}, layers: [] });
    expect(view.theme).toBeUndefined();
    expect(view.cost).toBe('light');
  });
});
