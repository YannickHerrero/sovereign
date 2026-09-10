<script lang="ts">
  import { tick } from 'svelte';
  import Icon from '../../../components/Icon.svelte';
  import { api } from '../../../lib/api';
  import { diffPrefs } from '../../../lib/diff/viewed.svelte';
  import { router } from '../../../lib/router.svelte';
  import type { FileDiff } from '../../../lib/types';
  import type { WorkspaceStore } from '../../../lib/workspace.svelte';
  import FileBlock from './FileBlock.svelte';
  import FileTree from './FileTree.svelte';

  let { store, taskId }: { store: WorkspaceStore; taskId: string } = $props();

  let files = $state<FileDiff[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let activePath = $state<string | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  /** Blocks near the viewport get their diff rendered; others stay a header until scrolled to. */
  let visible = $state<Record<string, boolean>>({});
  /** Patches arrive file by file as blocks come into view. */
  let patches = $state<Record<string, FileDiff>>({});
  let patchErrors = $state<Record<string, string>>({});
  const patchPending = new Set<string>();
  const fileCache = new Map<string, Promise<string>>();

  const task = $derived(store.task(taskId));
  const totalPlus = $derived(files.reduce((a, f) => a + f.plus, 0));
  const totalMinus = $derived(files.reduce((a, f) => a + f.minus, 0));

  $effect(() => store.acquire());

  $effect(() => {
    void load();
  });

  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  $effect(() => {
    if (!scroller || !files.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const path = (entry.target as HTMLElement).dataset.path!;
          if (entry.isIntersecting) {
            visible[path] = true;
            void fetchPatch(path);
          }
        }
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) activePath = (top.target as HTMLElement).dataset.path!;
      },
      { root: scroller, rootMargin: '600px 0px' },
    );
    for (const el of scroller.querySelectorAll<HTMLElement>('[data-path]')) observer.observe(el);
    return () => observer.disconnect();
  });

  async function load() {
    loading = true;
    error = null;
    try {
      // Stats first; each patch is fetched when its block scrolls into reach.
      files = (await api.diffSummary(store.server, taskId)).files;
      activePath = files[0]?.path ?? null;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function back() {
    router.back({ name: 'chat', wsId: store.server.id, taskId });
  }

  async function fetchPatch(path: string) {
    if (patches[path] || patchPending.has(path)) return;
    patchPending.add(path);
    try {
      const file = (await api.fileDiff(store.server, taskId, path)).files[0];
      if (file) patches[path] = file;
    } catch (err) {
      patchErrors[path] = (err as Error).message;
      patchPending.delete(path);
    }
  }

  async function jump(path: string) {
    activePath = path;
    visible[path] = true;
    void fetchPatch(path);
    await tick();
    scroller?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'start' });
  }

  function loadFile(path: string) {
    let pending = fileCache.get(path);
    if (!pending) {
      pending = api.file(store.server, taskId, path);
      fileCache.set(path, pending);
    }
    return pending;
  }
</script>

<div class="view">
  <header class="bar">
    <button class="back" aria-label="Back to conversation" onclick={back}>
      <Icon name="back" color="var(--ink-icon)" />
    </button>
    <div class="titles">
      <div class="title">{task?.title ?? 'Changes'}</div>
      <div class="sub">{task?.repo ?? ''}{files.length ? ` · ${files.length} ${files.length === 1 ? 'file' : 'files'}` : ''}</div>
    </div>
    {#if files.length}
      <span class="stats"><span class="plus">+{totalPlus}</span><span class="minus">-{totalMinus}</span></span>
    {/if}
    <div class="segmented" role="radiogroup" aria-label="Diff layout">
      <button role="radio" aria-checked={diffPrefs.mode === 'unified'} class:on={diffPrefs.mode === 'unified'} onclick={() => (diffPrefs.mode = 'unified')}>Unified</button>
      <button role="radio" aria-checked={diffPrefs.mode === 'split'} class:on={diffPrefs.mode === 'split'} onclick={() => (diffPrefs.mode = 'split')}>Split</button>
    </div>
  </header>

  <div class="columns">
    <FileTree {files} {activePath} isViewed={(p) => diffPrefs.isViewed(taskId, p)} onSelect={jump} />
    <div class="scroll blocks" bind:this={scroller}>
      {#if loading}
        <div class="empty">Loading changes…</div>
      {:else if error}
        <div class="empty error">{error}</div>
      {:else if !files.length}
        <div class="empty">No changes yet.</div>
      {/if}
      {#each files as file (file.path)}
        <div data-path={file.path}>
          {#if visible[file.path] && patches[file.path]}
            <FileBlock
              file={patches[file.path]}
              mode={diffPrefs.mode}
              viewed={diffPrefs.isViewed(taskId, file.path)}
              onViewed={(v) => diffPrefs.setViewed(taskId, file.path, v)}
              loadFile={() => loadFile(file.path)}
            />
          {:else}
            <div class="placeholder" class:failed={!!patchErrors[file.path]}>
              <span class="path">{file.path}</span>
              <span class="hint">{patchErrors[file.path] ?? (visible[file.path] ? 'Loading…' : '')}</span>
              <span class="stats"><span class="plus">+{file.plus}</span><span class="minus">-{file.minus}</span></span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .view {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: #fbfaf8;
  }
  .bar {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px 0 10px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .back {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .back:hover {
    background: var(--press);
  }
  .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .title {
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--muted-2);
    white-space: nowrap;
  }
  .stats {
    display: flex;
    gap: 6px;
    font-size: 12px;
  }
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--press);
  }
  .segmented button {
    padding: 3px 10px;
    border-radius: 6px;
    font-size: 12px;
    color: var(--muted-2);
  }
  .segmented button.on {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }
  .columns {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 260px minmax(0, 1fr);
  }
  .blocks {
    padding: 14px 18px 40px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
    min-height: 120px;
  }
  .path {
    font-family: var(--mono);
    font-size: 12px;
  }
  .hint {
    flex: 1;
    text-align: center;
    font-size: 12px;
    color: var(--muted-3);
  }
  .placeholder.failed .hint {
    color: var(--red);
  }
  .empty {
    padding: 40px;
    text-align: center;
    font-size: 13px;
    color: var(--muted-3);
  }
  .empty.error {
    color: var(--red);
  }
</style>
