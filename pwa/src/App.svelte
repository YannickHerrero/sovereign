<script lang="ts">
  import { router } from './lib/router.svelte';
  import Settings from './screens/Settings.svelte';
  import Workspaces from './screens/Workspaces.svelte';

  const route = $derived(router.route);
</script>

<div class="frame">
  {#if route.name === 'settings'}
    <Settings />
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
