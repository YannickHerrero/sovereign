const KEY = 'sovereign.drafts.v1';

/** Unsent composer text by draft id ("<workspace id>/<task id>" or "<workspace id>/new"). */
type Persisted = Record<string, string>;

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string' && v !== ''));
      }
    }
  } catch {
    // Storage unavailable or corrupt: defaults.
  }
  return {};
}

const data: Persisted = load();
const listeners = new Map<string, Set<(text: string) => void>>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Best effort only.
  }
}

/** Per-browser drafts, so text typed in one conversation survives switching to another. */
export const drafts = {
  get(id: string): string {
    return data[id] ?? '';
  },
  set(id: string, text: string) {
    if (text === '') {
      if (!(id in data)) return;
      delete data[id];
    } else {
      if (data[id] === text) return;
      data[id] = text;
    }
    persist();
  },
  clear(id: string) {
    this.set(id, '');
  },
  /**
   * Hands text back to the composer for `id`: appended live when one is mounted, otherwise
   * stored for the next time it opens.
   */
  push(id: string, text: string) {
    const live = listeners.get(id);
    if (live?.size) {
      for (const listener of live) listener(text);
      return;
    }
    const current = this.get(id);
    this.set(id, current ? `${current.trimEnd()}\n\n${text}` : text);
  },
  /** Receives text pushed to `id` while subscribed. Returns the unsubscribe function. */
  subscribe(id: string, listener: (text: string) => void): () => void {
    let set = listeners.get(id);
    if (!set) {
      set = new Set();
      listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) listeners.delete(id);
    };
  },
};
