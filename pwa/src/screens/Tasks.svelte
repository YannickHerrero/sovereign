<script lang="ts">
  import Composer from '../components/Composer.svelte';
  import Icon from '../components/Icon.svelte';
  import { api } from '../lib/api';
  import { router } from '../lib/router.svelte';
  import { FILTERS, group, stateMeta, type Filter } from '../lib/tasks';
  import type { Repo } from '../lib/types';
  import type { WorkspaceStore } from '../lib/workspace.svelte';

  let { store }: { store: WorkspaceStore } = $props();

  let searchOpen = $state(false);
  let query = $state('');
  let filterIx = $state(0);
  let repos = $state<Repo[]>([]);
  let repo = $state('');
  let composerOpen = $state(false);
  let error = $state<string | null>(null);

  const filter = $derived<Filter>(FILTERS[filterIx]);
  const groups = $derived(group(store.tasks, query, filter));
  const branch = $derived(repos.find((r) => r.name === repo)?.branch ?? null);

  $effect(() => store.acquire());

  $effect(() => {
    api
      .repos(store.server)
      .then((list) => {
        repos = list;
        if (!repo && list.length) repo = list[0].name;
      })
      .catch(() => {});
  });

  function toggleSearch() {
    searchOpen = !searchOpen;
    query = '';
  }

  function cycleFilter() {
    filterIx = (filterIx + 1) % FILTERS.length;
  }

  async function create(message: string) {
    if (!repo) {
      error = 'Choose a repo first';
      throw new Error(error);
    }
    error = null;
    try {
      const task = await api.createTask(store.server, repo, message);
      store.upsert(task);
      store.rememberFirstPrompt(task.id, message);
      router.go({ name: 'chat', wsId: store.server.id, taskId: task.id });
    } catch (err) {
      error = (err as Error).message;
      throw err;
    }
  }
</script>

<div class="screen screen--slide">
  <div class="topbar">
    <button class="round round--filled" aria-label="Back" onclick={() => router.back({ name: 'workspaces' })}>
      <Icon name="back" color="var(--ink-icon)" />
    </button>
    <div class="actions">
      <button class="round" aria-label="Search" onclick={toggleSearch}>
        <Icon name="search" color="var(--ink-icon)" />
      </button>
      <button class="round" aria-label="Filter" onclick={cycleFilter}>
        <Icon name="filter" color={filter ? 'var(--accent)' : 'var(--ink-icon)'} />
      </button>
    </div>
  </div>

  <div class="heading">
    <div class="title">{store.server.name}</div>
    {#if filter}
      <div class="subtitle">Filtered · {filter}</div>
    {:else if !store.connected && store.loaded}
      <div class="subtitle">{store.error ? 'Offline' : 'Reconnecting…'}</div>
    {/if}
  </div>

  {#if searchOpen}
    <div class="search">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="field" bind:value={query} placeholder="Search tasks and repos" autofocus autocapitalize="off" />
    </div>
  {/if}

  <div class="scroll list">
    {#each groups as g (g.label)}
      <div class="group">{g.label}</div>
      {#each g.items as t (t.id)}
        {@const meta = stateMeta(t.state)}
        <button class="row" onclick={() => router.go({ name: 'chat', wsId: store.server.id, taskId: t.id })}>
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
      <div class="empty">
        {#if store.error && store.tasks.length === 0}
          Can't reach this machine.
        {:else if query || filter}
          No tasks match that search.
        {:else}
          No tasks yet. Plan, ask or build something below.
        {/if}
      </div>
    {/if}
    {#if error}
      <div class="error">{error}</div>
    {/if}
  </div>

  <Composer
    bind:open={composerOpen}
    placeholder="Plan, ask, build…"
    {repo}
    {branch}
    {repos}
    onRepoChange={(name) => (repo = name)}
    onSubmit={create}
  />
</div>

<style>
  .actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .heading {
    padding: 0 22px 2px;
  }
  .search {
    padding: 10px 18px 2px;
    animation: fadeUp 0.18s ease both;
  }
  .list {
    padding: 12px 0 calc(var(--safe-bottom) + 128px);
    -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 92px), transparent 100%);
    mask-image: linear-gradient(180deg, transparent 0, #000 14px, #000 calc(100% - 92px), transparent 100%);
  }
  .group {
    padding: 14px 22px 7px;
    font-size: 12.5px;
    color: #96938b;
    letter-spacing: 0.1px;
  }
  .row {
    display: flex;
    gap: 11px;
    padding: 9px 22px;
    align-items: flex-start;
    width: 100%;
    text-align: left;
    transition: background 0.12s ease;
  }
  .row:active {
    background: rgba(0, 0, 0, 0.035);
  }
  .dotcol {
    width: 9px;
    display: flex;
    justify-content: center;
    padding-top: 6px;
    flex: none;
  }
  .main {
    min-width: 0;
    flex: 1;
  }
  .task-title {
    font-size: 14.5px;
    color: var(--ink);
    letter-spacing: -0.1px;
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
    font-size: 12px;
    color: var(--muted-2);
    white-space: nowrap;
  }
  .empty {
    padding: 40px 22px;
    text-align: center;
    font-size: 13.5px;
    color: var(--muted-3);
  }
  .error {
    margin: 8px 22px;
    font-size: 12.5px;
    color: var(--red);
  }
</style>
