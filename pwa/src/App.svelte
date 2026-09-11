<script lang="ts">
  import CommandPalette from './components/CommandPalette.svelte';
  let palette: CommandPalette;

  import { layout } from './lib/layout.svelte';
  import { router } from './lib/router.svelte';
  import { workspaceStore } from './lib/workspace.svelte';
  import Shell from './screens/desktop/Shell.svelte';
  import Settings from './screens/Settings.svelte';
  import Chat from './screens/Chat.svelte';
  import Tasks from './screens/Tasks.svelte';
  import Workspaces from './screens/Workspaces.svelte';

  const route = $derived(router.route);
  const store = $derived(route.name === 'tasks' || route.name === 'chat' ? workspaceStore(route.wsId) : undefined);

  $effect(() => {
    if ((route.name === 'tasks' || route.name === 'chat') && !store) router.replace({ name: 'workspaces' });
  });
</script>

<CommandPalette bind:this={palette} />
<div class="frame">
  {#if !layout.desktop}
    <div class="mobile-search"><button onclick={() => palette.show()}>Search discussions & machines</button></div>
  {/if}
  <div class="content">
  {#if layout.desktop}
    <Shell onSearch={() => palette.show()} />
  {:else if route.name === 'settings'}
    <Settings />
  {:else if route.name === 'tasks' && store}
    <Tasks {store} />
  {:else if route.name === 'chat' && store}
    {#key `${route.wsId}/${route.taskId}`}
      <Chat {store} taskId={route.taskId} />
    {/key}
  {:else}
    <Workspaces />
  {/if}
  </div>
</div>

<style>
  .frame { display: flex; flex-direction: column; }
  .content { position: relative; flex: 1; min-height: 0; overflow: hidden; }
  .mobile-search { flex: none; padding: calc(var(--safe-top) + 4px) 12px 4px; background: var(--bg); text-align: right; }
  .mobile-search button { font-size: 12px; color: var(--muted-2); padding: 6px 10px; border-radius: 8px; background: var(--press); }
  .frame {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
</style>
