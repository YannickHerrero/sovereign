<script lang="ts">
  import type { FileDiff } from '../lib/types';
  import Icon from './Icon.svelte';
  import Patch from './Patch.svelte';

  let { files, loading, onClose }: { files: FileDiff[]; loading: boolean; onClose: () => void } = $props();
</script>

<div class="screen sheet">
  <div class="topbar">
    <button class="round round--raised" aria-label="Close" onclick={onClose}>
      <Icon name="close" color="var(--ink-icon)" />
    </button>
    <div class="label">Diff</div>
    <span class="spacer"></span>
  </div>

  <div class="scroll body">
    {#if loading}
      <div class="empty">Loading…</div>
    {:else if files.length === 0}
      <div class="empty">No changes.</div>
    {/if}
    {#each files as file (file.path)}
      <Patch {file} />
    {/each}
  </div>
</div>

<style>
  .sheet {
    z-index: 50;
    animation: sheetUp 0.24s cubic-bezier(0.22, 0.8, 0.3, 1) both;
  }
  .topbar {
    flex-shrink: 0;
  }
  .label {
    flex: 1;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted-2);
  }
  .spacer {
    width: 36px;
  }
  .body {
    min-height: 0;
    padding: 8px 14px calc(var(--safe-bottom) + 30px);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .empty {
    padding: 40px 22px;
    text-align: center;
    font-size: 13.5px;
    color: var(--muted-3);
  }
</style>
