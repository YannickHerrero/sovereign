<script lang="ts">
  import { untrack } from 'svelte';
  import Composer from '../components/Composer.svelte';
  import Icon from '../components/Icon.svelte';
  import { api } from '../lib/api';
  import { router } from '../lib/router.svelte';
  import { prefs } from '../lib/prefs.svelte';
  import { FILTERS, dotVariant, groupTasks, type Filter } from '../lib/tasks';
  import type { ImageContent, PiModel, Repo } from '../lib/types';
  import type { WorkspaceStore } from '../lib/workspace.svelte';

  let { store }: { store: WorkspaceStore } = $props();

  let searchOpen = $state(false);
  let query = $state('');
  let filterIx = $state(0);
  let repos = $state<Repo[]>([]);
  let repo = $state('');
  let composerOpen = $state(false);
  let selectedModel = $state<PiModel | null>(null);
  let error = $state<string | null>(null);

  const filter = $derived<Filter>(FILTERS[filterIx]);
  const groups = $derived(groupTasks(prefs.grouping, store.tasks, query, filter));
  const byRepo = $derived(prefs.grouping === 'repo');
  const branch = $derived(repos.find((r) => r.name === repo)?.branch ?? null);

  $effect(() => store.acquire());

  $effect(() => {
    const server = store.server;
    let cancelled = false;
    repos = [];
    repo = '';
    selectedModel = untrack(() => prefs.lastModel(server.id));
    api.repos(server)
      .then((list) => {
        if (cancelled) return;
        repos = list;
        repo = prefs.defaultRepo(server.id, list, repo);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  });

  function chooseRepo(name: string) {
    repo = name;
    prefs.selectRepo(store.server.id, name);
  }

  function toggleSearch() {
    searchOpen = !searchOpen;
    query = '';
  }

  function cycleFilter() {
    filterIx = (filterIx + 1) % FILTERS.length;
  }

  async function loadModels() {
    const list = await api.models(store.server, repo);
    return { ...list, current: selectedModel ?? list.current };
  }

  async function create(message: string, images: ImageContent[]) {
    if (!repo) {
      error = 'Choose a repo first';
      throw new Error(error);
    }
    error = null;
    try {
      const task = await api.createTask(store.server, repo, message, images, selectedModel);
      store.upsert(task);
      store.rememberFirstPrompt(task.id, message, images);
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
    {#if filter && byRepo}
      <div class="subtitle">By project · {filter}</div>
    {:else if filter}
      <div class="subtitle">Filtered · {filter}</div>
    {:else if byRepo}
      <div class="subtitle">By project</div>
    {:else if !store.connected && store.loaded}
      <div class="subtitle">{store.error ? 'Offline' : 'Reconnecting…'}</div>
    {/if}
  </div>

  {#if searchOpen}
    <div class="search">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="field" bind:value={query} placeholder="Search tasks and repos" autofocus autocapitalize="off" />
      <div class="segmented" role="radiogroup" aria-label="Group tasks by">
        <button role="radio" aria-checked={!byRepo} class:on={!byRepo} onclick={() => (prefs.grouping = 'date')}>By date</button>
        <button role="radio" aria-checked={byRepo} class:on={byRepo} onclick={() => (prefs.grouping = 'repo')}>By project</button>
      </div>
    </div>
  {/if}

  <div class="scroll list">
    {#each groups as g (g.key)}
      {@const collapsed = byRepo && prefs.isCollapsed(store.server.id, g.label)}
      {#if byRepo}
        <button class="group group--repo" aria-expanded={!collapsed} onclick={() => prefs.toggleCollapsed(store.server.id, g.label)}>
          <span class="caret" class:closed={collapsed}><Icon name="chevron" color="var(--muted-3)" /></span>
          <span class="repo-name">{g.label}</span>
          {#if g.running > 0}<span class="dot dot--pulse" style:width="6px" style:height="6px"></span>{/if}
          <span class="count">{g.items.length}</span>
        </button>
      {:else}
        <div class="group">{g.label}</div>
      {/if}
      {#each collapsed ? [] : g.items as t (t.id)}
        <button class="row" onclick={() => router.go({ name: 'chat', wsId: store.server.id, taskId: t.id })}>
          <div class="dotcol">
            <span class="dot dot--{dotVariant(t)}"></span>
          </div>
          <div class="main">
            <div class="task-title">{t.title}</div>
            <div class="meta">
              <span>{t.repo}</span>
              {#if t.agent === 'claude'}
                <span class="agent-tag">Claude</span>
              {/if}
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
    onRepoChange={chooseRepo}
    model={selectedModel?.id} agent={selectedModel?.agent}
    {loadModels}
    onModelChange={(model) => { selectedModel = model; prefs.selectModel(store.server.id, model); }}
    modelDisabled={!repo}
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
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 10px;
    background: var(--press);
    align-self: flex-start;
  }
  .segmented button {
    padding: 5px 12px;
    border-radius: 8px;
    font-size: 12.5px;
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
    gap: 8px;
    width: 100%;
    text-align: left;
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
    font-size: 13px;
  }
  .count {
    margin-left: auto;
    font-size: 11.5px;
    color: var(--muted-3);
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
  .agent-tag {
    font-size: 10.5px;
    color: var(--accent);
    background: rgba(44, 111, 187, 0.1);
    border-radius: 999px;
    padding: 1px 6px;
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
