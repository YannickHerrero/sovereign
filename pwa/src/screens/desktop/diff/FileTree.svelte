<script lang="ts">
  import Icon from '../../../components/Icon.svelte';
  import { buildTree, filterPaths, type TreeNode } from '../../../lib/diff/tree';
  import type { FileDiff } from '../../../lib/types';

  interface Props {
    files: FileDiff[];
    activePath: string | null;
    isViewed: (path: string) => boolean;
    onSelect: (path: string) => void;
  }

  let { files, activePath, isViewed, onSelect }: Props = $props();

  let filter = $state('');
  let closed = $state<Record<string, boolean>>({});

  const stats = $derived(new Map(files.map((f) => [f.path, f])));
  const tree = $derived(buildTree(filterPaths(files.map((f) => f.path), filter)));
  const viewedCount = $derived(files.filter((f) => isViewed(f.path)).length);
</script>

{#snippet node(n: TreeNode, depth: number)}
  {#if n.file}
    {@const s = stats.get(n.path)}
    <button class="row file" class:active={n.path === activePath} class:viewed={isViewed(n.path)} style:padding-left="{10 + depth * 14}px" onclick={() => onSelect(n.path)} title={n.path}>
      <span class="doc"></span>
      <span class="name">{n.name}</span>
      {#if s}
        <span class="stats"><span class="plus">+{s.plus}</span><span class="minus">-{s.minus}</span></span>
      {/if}
    </button>
  {:else}
    <button class="row folder" style:padding-left="{10 + depth * 14}px" aria-expanded={!closed[n.path]} onclick={() => (closed[n.path] = !closed[n.path])}>
      <span class="caret" class:closed={closed[n.path]}><Icon name="chevron" color="var(--muted-3)" /></span>
      <span class="name">{n.name}</span>
    </button>
    {#if !closed[n.path]}
      {#each n.children as child (child.path + (child.file ? '' : '/'))}
        {@render node(child, depth + 1)}
      {/each}
    {/if}
  {/if}
{/snippet}

<aside class="tree">
  <div class="filter">
    <Icon name="search" color="var(--muted-3)" />
    <input bind:value={filter} placeholder="Filter files…" autocapitalize="off" />
  </div>
  <div class="summary">{files.length} {files.length === 1 ? 'file' : 'files'} · {viewedCount} viewed</div>
  <div class="scroll nodes">
    {#each tree as n (n.path + (n.file ? '' : '/'))}
      {@render node(n, 0)}
    {/each}
    {#if !tree.length}
      <div class="empty">No file matches.</div>
    {/if}
  </div>
</aside>

<style>
  .tree {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid rgba(0, 0, 0, 0.07);
    background: var(--bg);
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 10px 4px;
    padding: 6px 10px;
    border-radius: 9px;
    background: var(--press);
  }
  .filter input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12.5px;
    color: var(--ink);
  }
  .summary {
    padding: 4px 14px 6px;
    font-size: 11px;
    color: var(--muted-3);
  }
  .nodes {
    padding: 2px 6px 16px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 5px 8px 5px 10px;
    border-radius: 7px;
    text-align: left;
    font-size: 12.5px;
    color: var(--ink);
  }
  .row:hover {
    background: rgba(0, 0, 0, 0.04);
  }
  .row.active {
    background: rgba(0, 0, 0, 0.07);
  }
  .row.viewed .name {
    color: var(--muted-3);
  }
  .caret {
    display: flex;
    transition: transform 0.15s ease;
  }
  .caret.closed {
    transform: rotate(-90deg);
  }
  .folder .name {
    color: var(--ink-body);
  }
  .doc {
    width: 9px;
    height: 11px;
    flex: none;
    border: 1.4px solid var(--muted-3);
    border-radius: 2px;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stats {
    display: flex;
    gap: 4px;
    font-size: 10.5px;
    flex: none;
  }
  .empty {
    padding: 20px 14px;
    font-size: 12px;
    color: var(--muted-3);
  }
</style>
