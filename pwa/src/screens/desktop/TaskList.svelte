<script lang="ts">
  import Icon from '../../components/Icon.svelte';
  import { router } from '../../lib/router.svelte';
  import { group, stateMeta, type Filter } from '../../lib/tasks';
  import type { WorkspaceStore } from '../../lib/workspace.svelte';

  let { store, filter, activeTaskId }: { store: WorkspaceStore; filter: Filter; activeTaskId: string | undefined } = $props();

  let query = $state('');

  const groups = $derived(group(store.tasks, query, filter));
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
    <div class="sub">{subtitle}</div>
  </div>

  <div class="scroll rows">
    {#each groups as g (g.label)}
      <div class="group">{g.label}</div>
      {#each g.items as t (t.id)}
        {@const meta = stateMeta(t.state)}
        <button class="row" class:active={t.id === activeTaskId} onclick={() => router.go({ name: 'chat', wsId: store.server.id, taskId: t.id })}>
          <div class="dotcol">
            {#if t.state === 'working'}
              <span class="dot dot--pulse"></span>
            {:else}
              <span class="dot" style:background={meta.dot}></span>
            {/if}
          </div>
          <div class="main">
            <div class="task-title">{t.title}</div>
            <div class="meta">
              <span>{t.repo}</span>
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
  .empty {
    padding: 36px 18px;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted-3);
  }
</style>
