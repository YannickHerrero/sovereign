import { describe, expect, it } from 'vitest';
import { fuzzyScore, paletteActions, paletteEntries, searchPalette, type PaletteContext, type PaletteEntry } from './palette';

const entry = (title: string, updatedAt = 0, repo = ''): PaletteEntry => ({
  kind: 'discussion', wsId: 'host', taskId: title, title, subtitle: repo, repo, updatedAt,
});

const context: PaletteContext = {
  view: 'chat', desktop: true, wsId: 'host', taskId: 'one', pinned: false,
  wide: false, sidebarCollapsed: false, diffMode: 'unified',
};

describe('palette actions', () => {
  it('offers contextual navigation and non-destructive commands', () => {
    expect(paletteActions(context).map((e) => e.action)).toEqual(['diff', 'pin', 'copy', 'width', 'sidebar', 'new', 'settings']);
    expect(paletteActions({ ...context, view: 'diff' }).map((e) => e.action))
      .toEqual(['conversation', 'pin', 'copy', 'split', 'sidebar', 'new', 'settings']);
    expect(paletteActions({ ...context, view: 'diff', diffMode: 'split' }).map((e) => e.action)).toContain('unified');
  });
  it('hides desktop-only and unavailable commands', () => {
    expect(paletteActions({ ...context, desktop: false }).map((e) => e.action))
      .toEqual(['diff', 'pin', 'copy', 'new', 'settings']);
    expect(paletteActions({ ...context, desktop: false, view: 'settings', wsId: undefined, taskId: undefined }))
      .toEqual([]);
    expect(paletteActions({ ...context, pinned: undefined }).map((e) => e.action)).not.toContain('pin');
  });
  it('reflects preferences and pin state in the labels', () => {
    const entries = paletteActions({ ...context, wide: true, sidebarCollapsed: true, pinned: true });
    expect(entries.find((e) => e.action === 'width')?.title).toBe('Use standard width');
    expect(entries.find((e) => e.action === 'sidebar')?.title).toBe('Show sidebar');
    expect(entries.find((e) => e.action === 'pin')?.title).toBe('Unpin discussion');
  });
  it('uses bilingual aliases and ranks across categories when searching', () => {
    const entries = [...paletteActions(context), entry('the diff', 100), { ...entry('diff', 10), kind: 'machine' as const }];
    expect(searchPalette(entries, 'diff').map((e) => e.kind)).toEqual(['action', 'machine', 'discussion']);
    expect(searchPalette(entries, 'pleine largeur')[0]?.action).toBe('width');
    expect(searchPalette(entries, 'reglages')[0]?.action).toBe('settings');
    expect(searchPalette(entries, '')[0]?.kind).toBe('action');
  });
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
