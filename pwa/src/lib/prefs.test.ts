import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'sovereign.prefs.v1';
const repos = [{ name: 'alpha' }, { name: 'beta' }];
async function freshPrefs() {
  vi.resetModules();
  return (await import('./prefs.svelte')).prefs;
}

describe('last selected project', () => {
  beforeEach(() => localStorage.clear());

  it('remembers selection immediately and across reloads', async () => {
    const prefs = await freshPrefs();
    prefs.selectRepo('one', 'beta');
    expect(prefs.defaultRepo('one', repos)).toBe('beta');
    expect((await freshPrefs()).defaultRepo('one', repos)).toBe('beta');
  });

  it('isolates machines and lets an explicit project take priority', async () => {
    const prefs = await freshPrefs();
    prefs.selectRepo('one', 'beta');
    expect(prefs.defaultRepo('two', repos)).toBe('alpha');
    expect(prefs.defaultRepo('one', repos, 'alpha')).toBe('alpha');
    expect(prefs.defaultRepo('one', repos, 'deleted')).toBe('beta');
  });

  it('falls back when a project was deleted or no projects exist', async () => {
    const prefs = await freshPrefs();
    prefs.selectRepo('one', 'deleted');
    expect(prefs.defaultRepo('one', repos)).toBe('alpha');
    expect(prefs.defaultRepo('one', [])).toBe('');
  });

  it('loads older preferences without losing them', async () => {
    localStorage.setItem(KEY, JSON.stringify({ grouping: 'repo', collapsed: ['one/alpha'], wide: true }));
    const prefs = await freshPrefs();
    expect(prefs.defaultRepo('one', repos)).toBe('alpha');
    prefs.selectRepo('one', 'beta');
    expect(prefs.grouping).toBe('repo');
    expect(prefs.wide).toBe(true);
    expect(prefs.isCollapsed('one', 'alpha')).toBe(true);
  });

  it('tolerates corrupt or unavailable storage', async () => {
    localStorage.setItem(KEY, '{broken');
    const prefs = await freshPrefs();
    expect(prefs.defaultRepo('one', repos)).toBe('alpha');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    try {
      prefs.selectRepo('one', 'beta');
      expect(prefs.defaultRepo('one', repos)).toBe('beta');
    } finally {
      spy.mockRestore();
    }
  });
});
