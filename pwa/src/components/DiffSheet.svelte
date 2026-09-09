<script lang="ts">
  import type { FileDiff } from '../lib/types';
  import Icon from './Icon.svelte';

  let { files, loading, onClose }: { files: FileDiff[]; loading: boolean; onClose: () => void } = $props();

  function lineClass(line: string): string {
    if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
    if (line.startsWith('@@')) return 'hunk';
    if (line.startsWith('+')) return 'add';
    if (line.startsWith('-')) return 'del';
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) return 'meta';
    return '';
  }

  /** Drop the git header, keep hunks. */
  function body(patch: string): string[] {
    const lines = patch.split('\n');
    const start = lines.findIndex((l) => l.startsWith('@@'));
    return (start >= 0 ? lines.slice(start) : lines).filter((l, i, arr) => !(i === arr.length - 1 && l === ''));
  }
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
      <div class="file">
        <div class="file-head">
          <span class="path">{file.path}</span>
          <span class="stats"><span class="plus">+{file.plus}</span><span class="minus">-{file.minus}</span></span>
        </div>
        <pre class="patch">{#each body(file.patch) as line}<span class="line {lineClass(line)}">{line || ' '}</span>{/each}</pre>
      </div>
    {/each}
  </div>
</div>

<style>
  .sheet {
    z-index: 50;
    animation: sheetUp 0.24s cubic-bezier(0.22, 0.8, 0.3, 1) both;
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
    padding: 8px 14px calc(var(--safe-bottom) + 30px);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .file {
    background: var(--surface);
    border-radius: 14px;
    overflow: hidden;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.03);
  }
  .file-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg);
  }
  .path {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--ink-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stats {
    display: flex;
    gap: 6px;
    font-size: 11.5px;
    flex: none;
  }
  .patch {
    margin: 0;
    padding: 8px 0;
    font-family: var(--mono);
    font-size: 11px;
    line-height: 1.5;
    overflow-x: auto;
    display: flex;
    flex-direction: column;
  }
  .line {
    display: block;
    padding: 0 12px;
    white-space: pre;
    color: var(--ink-body);
  }
  .line.add {
    background: rgba(46, 139, 87, 0.1);
    color: #1f6b41;
  }
  .line.del {
    background: rgba(196, 72, 60, 0.09);
    color: #a23a30;
  }
  .line.hunk {
    color: var(--accent);
    padding-top: 4px;
  }
  .line.meta {
    color: var(--muted-3);
  }
  .empty {
    padding: 40px 22px;
    text-align: center;
    font-size: 13.5px;
    color: var(--muted-3);
  }
</style>
