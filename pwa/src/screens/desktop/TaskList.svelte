<script lang="ts">
  import Icon from '../../components/Icon.svelte';
  import { router } from '../../lib/router.svelte';
  import { prefs } from '../../lib/prefs.svelte';
  import { dotColor, groupTasks, stateMeta, type Filter } from '../../lib/tasks';
  import type { WorkspaceStore } from '../../lib/workspace.svelte';

  let { store, filter, activeTaskId }: { store: WorkspaceStore; filter: Filter; activeTaskId: string | undefined } = $props();

  let query = $state('');

  const groups = $derived(groupTasks(prefs.grouping, store.tasks, query, filter));
  const byRepo = $derived(prefs.grouping === 'repo');
  const running = $derived(store.tasks.filter((t) => t.state === 'working').length);
  const subtitle = $derived(
    !store.loaded
      ? 'Loading…'
      : store.error && store.tasks.length === 0
        ? "Can't reach this machine"
        : `${store.tasks.length} ${store.tasks.length === 1 ? 'task' : 'tasks'} · ${running ? `${running} running` : 'idle'}`,
  );

  $effect(() => store.acquire());
</script>

<section class="list">
  <div class="search">
    <Icon name="search" color="var(--muted-3)" />
    <input bind:value={query} placeholder="Search tasks" autocapitalize="off" />
    <button class="new" title="New task" aria-label="New task" onclick={() => router.go({ name: 'tasks', wsId: store.server.id })}>
      <Icon name="plus" color="var(--ink-control)" />
    </button>
  </div>

  <div class="heading">
    <div class="ws-name">{store.server.name}</div>
    <div class="sub-row">
      <div class="sub">{subtitle}</div>
      <div class="segmented" role="radiogroup" aria-label="Group tasks by">
        <button role="radio" aria-checked={!byRepo} class:on={!byRepo} onclick={() => (prefs.grouping = 'date')}>Date</button>
        <button role="radio" aria-checked={byRepo} class:on={byRepo} onclick={() => (prefs.grouping = 'repo')}>Project</button>
      </div>
    </div>
  </div>

  <div class="scroll rows">
    {#each groups as g (g.key)}
      {@const collapsed = byRepo && prefs.isCollapsed(store.server.id, g.label)}
      {#if byRepo}
        <div class="group group--repo">
          <button class="repo-toggle" aria-expanded={!collapsed} onclick={() => prefs.toggleCollapsed(store.server.id, g.label)}>
            <span class="caret" class:closed={collapsed}><Icon name="chevron" color="var(--muted-3)" /></span>
            <span class="repo-name">{g.label}</span>
            {#if g.running > 0}<span class="dot dot--pulse" style:width="6px" style:height="6px"></span>{/if}
          </button>
          <button class="repo-new" title="New task in {g.label}" aria-label="New task in {g.label}"
            onclick={() => { store.proposedRepo = g.label; router.go({ name: 'tasks', wsId: store.server.id }); }}>
            <Icon name="plus" color="var(--ink-control)" />
          </button>
          <span class="count">{g.items.length}</span>
        </div>
      {:else}
        <div class="group">{g.label}</div>
      {/if}
      {#each collapsed ? [] : g.items as t (t.id)}
        {@const meta = stateMeta(t.state)}
        <button class="row" class:active={t.id === activeTaskId} onclick={() => router.go({ name: 'chat', wsId: store.server.id, taskId: t.id })}>
          <div class="dotcol">
            {#if t.state === 'working'}
              <span class="dot dot--pulse"></span>
            {:else}
              <span class="dot" style:background={dotColor(t)}></span>
            {/if}
          </div>
          <div class="main">
            <div class="task-title">{t.title}</div>
            <div class="meta">
              <span>{t.repo}</span>
              {#if t.agent === 'claude'}
                <span class="agent-tag">Claude</span>
              {/if}
              <span class="sep">·</span>
              <span style:color={meta.color}>{meta.label}</span>
              {#if t.plus + t.minus > 0}
                <span class="sep">·</span>
                <span class="plus">+{t.plus}</span>
                <span class="minus">-{t.minus}</span>
              {/if}
            </div>
          </div>
        </button>
      {/each}
    {/each}
    {#if store.loaded && groups.length === 0}
      <div class="empty">{query || filter ? 'No tasks match.' : 'No tasks yet.'}</div>
    {/if}
  </div>
</section>

<style>
  .list {
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-right: 1px solid rgba(0, 0, 0, 0.07);
    min-height: 0;
  }
  .search {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px 0 16px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 13.5px;
    color: var(--ink);
  }
  .search input::placeholder {
    color: var(--muted-3);
  }
  .new {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .new:hover {
    background: var(--press);
  }
  .heading {
    padding: 14px 18px 6px;
  }
  .sub-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--press);
    flex: none;
  }
  .segmented button {
    padding: 3px 9px;
    border-radius: 6px;
    font-size: 11.5px;
    color: var(--muted-2);
  }
  .segmented button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .group--repo {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    text-align: left;
    padding-right: 14px;
  }
  .repo-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    flex: 1;
    text-align: left;
  }
  .repo-new {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.12s ease, background 0.12s ease;
  }
  .group--repo:hover .repo-new,
  .repo-new:focus-visible {
    opacity: 1;
  }
  .repo-new:hover {
    background: var(--press);
  }
  .caret {
    display: flex;
    transition: transform 0.15s ease;
  }
  .caret.closed {
    transform: rotate(-90deg);
  }
  .repo-name {
    color: var(--ink);
    font-weight: 500;
    font-size: 12px;
  }
  .count {
    font-size: 11px;
    color: var(--muted-3);
  }
  .ws-name {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.3px;
    color: var(--ink);
  }
  .sub {
    margin-top: 3px;
    font-size: 12px;
    color: var(--muted-2);
  }
  .rows {
    padding: 6px 0 12px;
  }
  .group {
    padding: 12px 18px 6px;
    font-size: 11.5px;
    color: #a09d94;
  }
  .row {
    display: flex;
    gap: 10px;
    margin: 0 8px;
    padding: 9px 10px;
    border-radius: 9px;
    width: calc(100% - 16px);
    text-align: left;
    transition: background 0.12s ease;
  }
  .row:hover {
    background: rgba(0, 0, 0, 0.04);
  }
  .row.active {
    background: rgba(0, 0, 0, 0.06);
  }
  .dotcol {
    width: 8px;
    flex: none;
    display: flex;
    justify-content: center;
    padding-top: 5px;
  }
  .main {
    min-width: 0;
    flex: 1;
  }
  .task-title {
    font-size: 13.5px;
    color: var(--ink);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    margin-top: 3px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--muted-2);
    white-space: nowrap;
  }
  .agent-tag {
    font-size: 10.5px;
    color: var(--accent);
    background: rgba(44, 111, 187, 0.1);
    border-radius: 999px;
    padding: 1px 6px;
  }
  .empty {
    padding: 36px 18px;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted-3);
  }
</style>
