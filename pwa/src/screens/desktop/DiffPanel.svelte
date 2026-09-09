<script lang="ts">
  import Icon from '../../components/Icon.svelte';
  import Patch from '../../components/Patch.svelte';
  import type { FileDiff } from '../../lib/types';

  let { files, loading, onClose }: { files: FileDiff[]; loading: boolean; onClose: () => void } = $props();

  const totalPlus = $derived(files.reduce((a, f) => a + f.plus, 0));
  const totalMinus = $derived(files.reduce((a, f) => a + f.minus, 0));
</script>

<button class="backdrop" aria-label="Close diff" onclick={onClose}></button>
<aside class="panel">
  <div class="head">
    <span class="label">Diff</span>
    {#if files.length}
      <span class="stats"><span class="plus">+{totalPlus}</span><span class="minus">-{totalMinus}</span></span>
    {/if}
    <span class="grow"></span>
    <button class="close" aria-label="Close" onclick={onClose}>
      <Icon name="close" color="var(--ink-icon)" />
    </button>
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
</aside>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 40;
    background: rgba(30, 28, 24, 0.08);
    cursor: default;
  }
  .panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(520px, 100%);
    z-index: 41;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border-left: 1px solid rgba(0, 0, 0, 0.08);
    box-shadow: -12px 0 32px rgba(0, 0, 0, 0.08);
    animation: slideIn 0.22s cubic-bezier(0.22, 0.8, 0.3, 1) both;
  }
  .head {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px 0 18px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .label {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink);
  }
  .stats {
    display: flex;
    gap: 6px;
    font-size: 12px;
  }
  .grow {
    flex: 1;
  }
  .close {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .close:hover {
    background: var(--press);
  }
  .body {
    min-height: 0;
    padding: 12px 14px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .empty {
    padding: 40px 22px;
    text-align: center;
    font-size: 13px;
    color: var(--muted-3);
  }
</style>
