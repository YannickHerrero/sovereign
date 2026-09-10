const KEY = 'sovereign.diff.v1';

export type DiffMode = 'unified' | 'split';

interface Persisted {
  mode: DiffMode;
  /** Viewed files as "<task id>/<path>", capped to keep storage small. */
  viewed: string[];
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return { mode: parsed.mode === 'split' ? 'split' : 'unified', viewed: parsed.viewed ?? [] };
    }
  } catch {
    // Storage unavailable or corrupt: defaults.
  }
  return { mode: 'unified', viewed: [] };
}

const data = $state<Persisted>(load());

function persist() {
  try {
    if (data.viewed.length > 2000) data.viewed.splice(0, data.viewed.length - 2000);
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Best effort only.
  }
}

export const diffPrefs = {
  get mode(): DiffMode {
    return data.mode;
  },
  set mode(value: DiffMode) {
    data.mode = value;
    persist();
  },
  isViewed(taskId: string, path: string): boolean {
    return data.viewed.includes(`${taskId}/${path}`);
  },
  setViewed(taskId: string, path: string, viewed: boolean) {
    const id = `${taskId}/${path}`;
    const index = data.viewed.indexOf(id);
    if (viewed && index < 0) data.viewed.push(id);
    if (!viewed && index >= 0) data.viewed.splice(index, 1);
    persist();
  },
};
