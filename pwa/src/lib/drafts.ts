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
};
