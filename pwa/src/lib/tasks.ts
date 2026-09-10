import { isToday } from './format';
import type { TaskState, TaskSummary } from './types';

export type Filter = null | 'Working' | 'Has changes' | 'Failed';

export const FILTERS: Filter[] = [null, 'Working', 'Has changes', 'Failed'];

export type Grouping = 'date' | 'repo';

export interface Group {
  /** Stable key for rendering and for remembering the collapsed state. */
  key: string;
  label: string;
  items: TaskSummary[];
  /** Number of tasks currently running in the group (repo grouping only). */
  running: number;
}

export function matches(task: TaskSummary, query: string, filter: Filter): boolean {
  const q = query.trim().toLowerCase();
  if (q && !`${task.title} ${task.repo}`.toLowerCase().includes(q)) return false;
  if (filter === 'Working') return task.state === 'working';
  if (filter === 'Has changes') return task.plus + task.minus > 0;
  if (filter === 'Failed') return task.state === 'failed';
  return true;
}

/** Pinned / Today / Earlier, most recently updated first inside each group. */
export function group(tasks: TaskSummary[], query: string, filter: Filter, now = Date.now()): Group[] {
  const sorted = [...tasks].filter((t) => matches(t, query, filter)).sort((a, b) => b.updated_at - a.updated_at);
  const pinned = sorted.filter((t) => t.pinned);
  const today = sorted.filter((t) => !t.pinned && isToday(t.updated_at, now));
  const earlier = sorted.filter((t) => !t.pinned && !isToday(t.updated_at, now));
  return [
    { key: 'pinned', label: 'Pinned', items: pinned, running: 0 },
    { key: 'today', label: 'Today', items: today, running: 0 },
    { key: 'earlier', label: 'Earlier', items: earlier, running: 0 },
  ].filter((g) => g.items.length > 0);
}

/** One group per repo, most recently active repo first; pinned tasks lead inside a repo. */
export function groupByRepo(tasks: TaskSummary[], query: string, filter: Filter): Group[] {
  const byRepo = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    if (!matches(task, query, filter)) continue;
    byRepo.set(task.repo, [...(byRepo.get(task.repo) ?? []), task]);
  }
  return [...byRepo.entries()]
    .map(([repo, items]) => ({
      key: `repo:${repo}`,
      label: repo,
      items: items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at - a.updated_at),
      running: items.filter((t) => t.state === 'working').length,
    }))
    .sort((a, b) => Math.max(...b.items.map((t) => t.updated_at)) - Math.max(...a.items.map((t) => t.updated_at)));
}

export function groupTasks(grouping: Grouping, tasks: TaskSummary[], query: string, filter: Filter): Group[] {
  return grouping === 'repo' ? groupByRepo(tasks, query, filter) : group(tasks, query, filter);
}

export interface StateMeta {
  label: string;
  /** CSS color for the label */
  color: string;
}

export function stateMeta(state: TaskState): StateMeta {
  switch (state) {
    case 'working':
      return { label: 'Working', color: 'var(--accent)' };
    case 'done':
      return { label: '✓ Done', color: 'var(--muted-2)' };
    case 'failed':
      return { label: 'Failed', color: 'var(--muted-2)' };
    case 'no_changes':
      return { label: 'No Changes', color: 'var(--muted-2)' };
    case 'pending':
      return { label: 'Starting', color: 'var(--muted-2)' };
  }
}

/**
 * The dot asks for attention rather than restating the outcome: red for failures, green for a
 * finished run the user has not opened yet, grey once seen. Working tasks render a pulsing dot.
 */
export function dotColor(task: Pick<TaskSummary, 'state' | 'unread'>): string {
  if (task.state === 'failed') return 'var(--red)';
  if (task.unread) return 'var(--green)';
  return 'var(--muted-5)';
}
