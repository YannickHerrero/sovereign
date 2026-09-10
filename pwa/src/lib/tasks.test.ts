import { describe, expect, it } from 'vitest';
import { group, groupByRepo } from './tasks';
import type { TaskSummary } from './types';

function task(over: Partial<TaskSummary>): TaskSummary {
  return {
    id: Math.random().toString(36).slice(2),
    agent: 'pi',
    repo: 'alpha',
    title: 'Task',
    pinned: false,
    state: 'done',
    plus: 1,
    minus: 0,
    created_at: 0,
    updated_at: 0,
    ...over,
  };
}

describe('groupByRepo', () => {
  const tasks = [
    task({ id: 'a1', repo: 'alpha', updated_at: 10 }),
    task({ id: 'a2', repo: 'alpha', updated_at: 50, pinned: true }),
    task({ id: 'a3', repo: 'alpha', updated_at: 70, state: 'working', plus: 0 }),
    task({ id: 'b1', repo: 'beta', updated_at: 90 }),
    task({ id: 'c1', repo: 'gamma', title: 'needle', updated_at: 5, state: 'failed', plus: 0 }),
  ];

  it('orders repos by latest activity and pinned tasks first inside a repo', () => {
    const groups = groupByRepo(tasks, '', null);
    expect(groups.map((g) => g.label)).toEqual(['beta', 'alpha', 'gamma']);
    expect(groups[1].items.map((t) => t.id)).toEqual(['a2', 'a3', 'a1']);
    expect(groups[1].running).toBe(1);
    expect(groups[1].key).toBe('repo:alpha');
  });

  it('applies the search and the state filter and drops empty repos', () => {
    expect(groupByRepo(tasks, 'needle', null).map((g) => g.label)).toEqual(['gamma']);
    expect(groupByRepo(tasks, '', 'Working').map((g) => g.label)).toEqual(['alpha']);
    expect(groupByRepo(tasks, '', 'Has changes').map((g) => [g.label, g.items.length])).toEqual([
      ['beta', 1],
      ['alpha', 2],
    ]);
  });

  it('keeps the date grouping keys stable', () => {
    expect(group(tasks, '', null, 1_000_000).map((g) => g.key)).toEqual(['pinned', 'today']);
    expect(group(tasks, '', null, 10 * 86_400_000).map((g) => g.key)).toEqual(['pinned', 'earlier']);
  });
});
