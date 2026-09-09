<script lang="ts">
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

<div class="frame">
  {#if layout.desktop}
    <Shell />
  {:else if route.name === 'settings'}
    <Settings />
  {:else if route.name === 'tasks' && store}
    <Tasks {store} />
  {:else if route.name === 'chat' && store}
    {#key route.taskId}
      <Chat {store} taskId={route.taskId} />
    {/key}
  {:else}
    <Workspaces />
  {/if}
</div>

<style>
  .frame {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
</style>
