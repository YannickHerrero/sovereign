import { isToday } from './format';
import type { TaskState, TaskSummary } from './types';

export type Filter = null | 'Working' | 'Has changes' | 'Failed';

export const FILTERS: Filter[] = [null, 'Working', 'Has changes', 'Failed'];

export interface Group {
  label: string;
  items: TaskSummary[];
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
    { label: 'Pinned', items: pinned },
    { label: 'Today', items: today },
    { label: 'Earlier', items: earlier },
  ].filter((g) => g.items.length > 0);
}

export interface StateMeta {
  label: string;
  /** CSS color for the label */
  color: string;
  /** CSS color for the idle dot */
  dot: string;
}

export function stateMeta(state: TaskState): StateMeta {
  switch (state) {
    case 'working':
      return { label: 'Working', color: 'var(--accent)', dot: 'var(--accent)' };
    case 'done':
      return { label: '✓ Done', color: 'var(--muted-2)', dot: 'var(--green)' };
    case 'failed':
      return { label: 'Failed', color: 'var(--muted-2)', dot: 'var(--red)' };
    case 'no_changes':
      return { label: 'No Changes', color: 'var(--muted-2)', dot: 'var(--muted-5)' };
    case 'pending':
      return { label: 'Starting', color: 'var(--muted-2)', dot: 'var(--muted-5)' };
  }
}
