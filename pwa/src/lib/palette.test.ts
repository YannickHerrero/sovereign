import { describe, expect, it } from 'vitest';
import { fuzzyScore, paletteEntries, searchPalette, type PaletteEntry } from './palette';

const entry = (title: string, updatedAt = 0, repo = ''): PaletteEntry => ({
  kind: 'discussion', wsId: 'host', taskId: title, title, subtitle: repo, repo, updatedAt,
});

describe('palette search', () => {
  it('matches case, accents and non-adjacent characters', () => {
    expect(fuzzyScore('Réparer le Composer', 'REPARER')).toBe(1);
    expect(fuzzyScore('Composer', 'cmps')).not.toBeNull();
    expect(fuzzyScore('Composer', 'zcm')).toBeNull();
  });
  it('ranks exact, prefix, substring, then fuzzy matches', () => {
    const titles = ['c_o_m', 'the com', 'composer', 'com'];
    expect(searchPalette(titles.map((t) => entry(t)), 'com').map((e) => e.title))
      .toEqual(['com', 'composer', 'the com', 'c_o_m']);
  });
  it('uses recency for empty searches and ties, and searches projects', () => {
    const entries = [entry('Old', 1), entry('Recent', 2, 'sovereign')];
    expect(searchPalette(entries, '  ')[0]?.title).toBe('Recent');
    expect(searchPalette(entries, 'svrgn')[0]?.title).toBe('Recent');
    expect(searchPalette(entries, 'missing')).toEqual([]);
    expect(searchPalette([], '')).toEqual([]);
  });
  it('includes configured hosts without a current workspace', () => {
    const entries = paletteEntries([], [{ id: 'h', name: 'Laptop', url: 'http://localhost', token: '' }]);
    expect(searchPalette(entries, 'lptp')[0]).toMatchObject({ kind: 'machine', wsId: 'h' });
  });
});
