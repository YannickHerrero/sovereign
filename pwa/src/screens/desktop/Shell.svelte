<script lang="ts">
  import { layout } from '../../lib/layout.svelte';
  import { router } from '../../lib/router.svelte';
  import { settings } from '../../lib/settings.svelte';
  import { FILTERS, type Filter } from '../../lib/tasks';
  import { workspaceStore } from '../../lib/workspace.svelte';
  import Settings from '../Settings.svelte';
  import NewTaskPane from './NewTaskPane.svelte';
  import Sidebar from './Sidebar.svelte';
  import TaskList from './TaskList.svelte';
  import TaskPane from './TaskPane.svelte';
  import DiffView from './diff/DiffView.svelte';

  const route = $derived(router.route);
  const wsId = $derived('wsId' in route ? route.wsId : (settings.servers[0]?.id ?? undefined));
  const store = $derived(wsId ? workspaceStore(wsId) : undefined);
  const taskId = $derived(route.name === 'chat' || route.name === 'diff' ? route.taskId : undefined);

  let filter = $state<Filter>(FILTERS[0]);
  let model = $state<string | null>(null);

  // Desktop has no standalone workspaces screen: land on the first machine.
  $effect(() => {
    if (route.name === 'workspaces' && settings.servers.length) {
      router.replace({ name: 'tasks', wsId: settings.servers[0].id });
    }
  });
</script>

<div class="shell" class:sidebar-collapsed={layout.sidebarCollapsed}>
  <Sidebar {store} {filter} onFilter={(f) => (filter = f)} {model}
    collapsed={layout.sidebarCollapsed} onToggle={() => layout.toggleSidebar()} />

  {#if store}
    <TaskList {store} {filter} activeTaskId={taskId} />
  {:else}
    <section class="column empty-column"></section>
  {/if}

  {#if route.name === 'settings'}
    <section class="column settings">
      <Settings embedded />
    </section>
  {:else if store && taskId && route.name === 'diff'}
    {#key taskId}
      <DiffView {store} {taskId} />
    {/key}
  {:else if store && taskId}
    {#key taskId}
      <TaskPane {store} {taskId} onModel={(m) => (model = m)} />
    {/key}
  {:else if store}
    <NewTaskPane {store} />
  {:else}
    <section class="column welcome">
      <div>
        <div class="welcome-title">No machine configured</div>
        <p>Add a Sovereign server in Settings to start working.</p>
        <button class="btn" onclick={() => router.go({ name: 'settings' })}>Open Settings</button>
      </div>
    </section>
  {/if}
</div>

<style>
  .shell {
    display: grid;
    grid-template-columns: 252px 352px minmax(0, 1fr);
    height: 100%;
    background: var(--bg);
  }
  .shell.sidebar-collapsed {
    grid-template-columns: 52px 352px minmax(0, 1fr);
  }
  .column {
    position: relative;
    min-height: 0;
    min-width: 0;
    background: #fbfaf8;
  }
  .empty-column {
    background: var(--bg);
    border-right: 1px solid rgba(0, 0, 0, 0.07);
  }
  .settings {
    overflow: hidden;
  }
  .welcome {
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--muted-2);
    font-size: 13.5px;
  }
  .welcome-title {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.3px;
    color: var(--ink);
    margin-bottom: 6px;
  }
  .btn {
    margin-top: 10px;
    padding: 8px 16px;
    border-radius: 999px;
    background: var(--dark);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
  }
</style>
