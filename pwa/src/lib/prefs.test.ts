import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Model } from './types';

const model: Model = { agent: 'pi', provider: 'openai', id: 'test-model', name: 'Test model', input: ['text', 'image'] };
const KEY = 'sovereign.prefs.v1';
const repos = [{ name: 'alpha' }, { name: 'beta' }];
async function freshPrefs() {
  vi.resetModules();
  return (await import('./prefs.svelte')).prefs;
}

describe('last selected model', () => {
  beforeEach(() => localStorage.clear());

  it('persists the full model identity immediately and across reloads', async () => {
    const prefs = await freshPrefs();
    expect(prefs.lastModel('one')).toBeNull();
    prefs.selectModel('one', model);
    expect(prefs.lastModel('one')).toEqual(model);
    expect((await freshPrefs()).lastModel('one')).toEqual(model);
  });

  it('isolates machines and keeps the model when the project changes', async () => {
    const prefs = await freshPrefs();
    prefs.selectModel('one', model);
    prefs.selectRepo('one', 'beta');
    expect(prefs.lastModel('one')).toEqual(model);
    expect(prefs.lastModel('two')).toBeNull();
    const claude: Model = { ...model, agent: 'claude', provider: 'anthropic' };
    prefs.selectModel('one', claude);
    expect((await freshPrefs()).lastModel('one')).toEqual(claude);
  });

  it('ignores malformed models in storage', async () => {
    localStorage.setItem(KEY, JSON.stringify({ lastModels: { valid: model, invalid: { id: 'missing-provider' }, nil: null } }));
    const prefs = await freshPrefs();
    expect(prefs.lastModel('valid')).toEqual(model);
    expect(prefs.lastModel('invalid')).toBeNull();
    expect(prefs.lastModel('nil')).toBeNull();
  });

  it('remembers model changes in existing chats only after success', async () => {
    const prefs = await freshPrefs();
    const { api } = await import('./api');
    const { ChatSession } = await import('./chat.svelte');
    const { WorkspaceStore } = await import('./workspace.svelte');
    const store = new WorkspaceStore({ id: 'one', name: 'One', url: 'http://localhost', token: '' });
    const chat = new ChatSession(store, 'task');
    const spy = vi.spyOn(api, 'setModel').mockResolvedValue(model);
    try {
      await chat.changeModel(model);
      expect(prefs.lastModel('one')).toEqual(model);
      spy.mockRejectedValueOnce(new Error('unavailable'));
      await expect(chat.changeModel({ ...model, id: 'other' })).rejects.toThrow('unavailable');
      expect(prefs.lastModel('one')).toEqual(model);
    } finally {
      spy.mockRestore();
    }
  });
});

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
