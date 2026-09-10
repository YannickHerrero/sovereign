import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'sovereign.drafts.v1';

/** The module reads storage once at import time, so each call gets a fresh copy. */
async function freshDrafts() {
  vi.resetModules();
  return (await import('./drafts')).drafts;
}

describe('drafts', () => {
  beforeEach(() => localStorage.clear());

  it('returns an empty string for unknown ids', async () => {
    const drafts = await freshDrafts();
    expect(drafts.get('ws/task')).toBe('');
  });

  it('persists text and reloads it', async () => {
    const drafts = await freshDrafts();
    drafts.set('ws/task', 'hello');
    expect(drafts.get('ws/task')).toBe('hello');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ 'ws/task': 'hello' });

    const reloaded = await freshDrafts();
    expect(reloaded.get('ws/task')).toBe('hello');
  });

  it('drops the entry when the text becomes empty', async () => {
    const drafts = await freshDrafts();
    drafts.set('ws/task', 'hello');
    drafts.set('ws/task', '');
    expect(drafts.get('ws/task')).toBe('');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({});
  });

  it('clears a draft', async () => {
    const drafts = await freshDrafts();
    drafts.set('ws/a', 'one');
    drafts.set('ws/b', 'two');
    drafts.clear('ws/a');
    expect(drafts.get('ws/a')).toBe('');
    expect(drafts.get('ws/b')).toBe('two');
  });

  it('ignores corrupt storage', async () => {
    localStorage.setItem(KEY, '{not json');
    const drafts = await freshDrafts();
    expect(drafts.get('ws/task')).toBe('');
    localStorage.setItem(KEY, JSON.stringify({ ok: 'yes', bad: 3, empty: '' }));
    const filtered = await freshDrafts();
    expect(filtered.get('ok')).toBe('yes');
    expect(filtered.get('bad')).toBe('');
    expect(filtered.get('empty')).toBe('');
  });
});

describe('drafts.push', () => {
  beforeEach(() => localStorage.clear());

  it('delivers to a mounted composer instead of storage', async () => {
    const drafts = await freshDrafts();
    const received: string[] = [];
    const unsubscribe = drafts.subscribe('ws/task', (text) => received.push(text));
    drafts.push('ws/task', 'hello');
    expect(received).toEqual(['hello']);
    expect(drafts.get('ws/task')).toBe('');
    unsubscribe();
    drafts.push('ws/task', 'later');
    expect(received).toEqual(['hello']);
    expect(drafts.get('ws/task')).toBe('later');
  });

  it('appends to a stored draft when nobody listens', async () => {
    const drafts = await freshDrafts();
    drafts.set('ws/task', 'first ');
    drafts.push('ws/task', 'second');
    expect(drafts.get('ws/task')).toBe('first\n\nsecond');
  });
});
