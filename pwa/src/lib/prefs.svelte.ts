import type { Grouping } from './tasks';
import type { Model } from './types';

const KEY = 'sovereign.prefs.v1';

interface Persisted {
  grouping: Grouping;
  /** Collapsed repo sections, as "<workspace id>/<repo>". */
  collapsed: string[];
  /** Desktop conversation without the 720px column, like Notion's full width. */
  wide: boolean;
  /** Last explicitly selected project per machine. */
  lastRepos: Record<string, string>;
  lastModels: Record<string, Model>;
}

function isModel(value: unknown): value is Model {
  if (!value || typeof value !== 'object') return false;
  const model = value as Partial<Model>;
  return (model.agent === 'pi' || model.agent === 'claude')
    && typeof model.provider === 'string' && typeof model.id === 'string'
    && typeof model.name === 'string' && Array.isArray(model.input)
    && model.input.every((input) => typeof input === 'string');
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      return {
        grouping: parsed.grouping === 'repo' ? 'repo' : 'date',
        collapsed: parsed.collapsed ?? [],
        wide: parsed.wide === true,
        lastRepos: Object.fromEntries(Object.entries(parsed.lastRepos ?? {}).filter(([, value]) => typeof value === 'string')),
        lastModels: Object.fromEntries(Object.entries(parsed.lastModels ?? {}).filter(([, value]) => isModel(value))),
      };
    }
  } catch {
    // Storage unavailable or corrupt: defaults.
  }
  return { grouping: 'date', collapsed: [], wide: false, lastRepos: {}, lastModels: {} };
}

const data = $state<Persisted>(load());

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Best effort only.
  }
}

/** Per-browser display preferences for the task list. */
export const prefs = {
  selectModel(wsId: string, model: Model) {
    data.lastModels[wsId] = { ...model, input: [...model.input] };
    persist();
  },
  lastModel(wsId: string): Model | null {
    return data.lastModels[wsId] ?? null;
  },
  selectRepo(wsId: string, repo: string) {
    data.lastRepos[wsId] = repo;
    persist();
  },
  defaultRepo(wsId: string, repos: { name: string }[], proposed = ''): string {
    const remembered = data.lastRepos[wsId];
    return [proposed, remembered].find((name) => repos.some((repo) => repo.name === name)) ?? repos[0]?.name ?? '';
  },
  get grouping(): Grouping {
    return data.grouping;
  },
  set grouping(value: Grouping) {
    data.grouping = value;
    persist();
  },
  get wide(): boolean {
    return data.wide;
  },
  set wide(value: boolean) {
    data.wide = value;
    persist();
  },
  isCollapsed(wsId: string, repo: string): boolean {
    return data.collapsed.includes(`${wsId}/${repo}`);
  },
  toggleCollapsed(wsId: string, repo: string) {
    const id = `${wsId}/${repo}`;
    const index = data.collapsed.indexOf(id);
    if (index >= 0) data.collapsed.splice(index, 1);
    else data.collapsed.push(id);
    persist();
  },
};
