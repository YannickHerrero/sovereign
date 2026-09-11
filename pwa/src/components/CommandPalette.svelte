<script lang="ts">
  import { tick } from 'svelte';
  import { layout } from '../lib/layout.svelte';
  import { api } from '../lib/api';
  import { diffPrefs } from '../lib/diff/viewed.svelte';
  import { prefs } from '../lib/prefs.svelte';
  import { presence } from '../lib/presence.svelte';
  import { dotVariant } from '../lib/tasks';
  import { paletteActions, paletteEntries, searchPalette, type PaletteEntry } from '../lib/palette';
  import { pathOf, router } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';
  import { workspaceStore } from '../lib/workspace.svelte';

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let open = $state(false);
  let query = $state('');
  let selected = $state(0);
  let notice = $state('');
  let failed = $state(false);
  let pending = $state(false);
  const route = $derived(router.route);
  const wsId = $derived('wsId' in route ? route.wsId : layout.desktop ? settings.servers[0]?.id : undefined);
  const store = $derived(wsId ? workspaceStore(wsId) : undefined);
  const taskId = $derived('taskId' in route ? route.taskId : undefined);
  const actions = $derived(paletteActions({
    view: route.name, desktop: layout.desktop, wsId, taskId,
    pinned: taskId ? store?.task(taskId)?.pinned : undefined,
    wide: prefs.wide, sidebarCollapsed: layout.sidebarCollapsed, diffMode: diffPrefs.mode,
  }));
  const results = $derived(searchPalette([...actions, ...paletteEntries(store?.tasks ?? [], settings.servers, wsId)], query));
  const labels = { action: 'Actions', discussion: 'Discussions', machine: 'Machines' };
  const active = $derived(Math.min(selected, Math.max(0, results.length - 1)));

  $effect(() => { if (open && store) return store.acquire(); });
  $effect(() => {
    if (open) document.getElementById(`palette-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  });

  export async function show() {
    if (pending || dialog.open || document.querySelector('dialog[open]')) return;
    notice = '';
    query = '';
    selected = 0;
    open = true;
    dialog.showModal();
    await tick();
    input.focus();
  }

  function shortcut(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    event.preventDefault();
    if (event.repeat) return;
    if (dialog.open) dialog.close();
    else void show();
  }

  function dotColor(entry: PaletteEntry): string {
    if (entry.kind === 'discussion') {
      const task = store?.task(entry.taskId!);
      if (task) return { working: 'var(--amber)', alert: 'var(--red)', fresh: 'var(--green)', idle: 'var(--muted-5)' }[dotVariant(task)];
    }
    if (entry.kind === 'machine') return presence.status(entry.wsId)?.online ? 'var(--green)' : 'var(--muted-5)';
    return '#d5d2c9';
  }

  function metadata(entry: PaletteEntry): string {
    if (entry.kind !== 'action' || entry.subtitle !== 'Action') return entry.subtitle;
    if (entry.action === 'new') return store?.server.name ?? '';
    if (entry.action === 'pin') return store?.task(entry.taskId!)?.title ?? '';
    if (entry.action === 'diff' || entry.action === 'conversation') return store?.task(entry.taskId!)?.repo ?? '';
    return '';
  }

  async function choose(entry: PaletteEntry) {
    if (pending) return;
    dialog.close();
    if (entry.kind !== 'action') {
      router.go(entry.kind === 'discussion'
        ? { name: 'chat', wsId: entry.wsId, taskId: entry.taskId! }
        : { name: 'tasks', wsId: entry.wsId });
      return;
    }
    pending = true;
    failed = false;
    notice = '';
    try {
      switch (entry.action) {
        case 'diff': router.go({ name: 'diff', wsId: entry.wsId, taskId: entry.taskId! }); break;
        case 'conversation': router.go({ name: 'chat', wsId: entry.wsId, taskId: entry.taskId! }); break;
        case 'width': prefs.wide = !prefs.wide; break;
        case 'split': case 'unified': diffPrefs.mode = entry.action; break;
        case 'sidebar': layout.toggleSidebar(); break;
        case 'settings': router.go({ name: 'settings' }); break;
        case 'new': router.go({ name: 'tasks', wsId: entry.wsId, compose: true }); break;
        case 'pin': {
          const target = workspaceStore(entry.wsId);
          const task = target?.task(entry.taskId!);
          if (!target || !task) throw new Error('Discussion is no longer available.');
          target.upsert(await api.patchTask(target.server, task.id, { pinned: !task.pinned }));
          notice = task.pinned ? 'Discussion unpinned' : 'Discussion pinned';
          break;
        }
        case 'copy':
          await navigator.clipboard.writeText(new URL(pathOf({ name: 'chat', wsId: entry.wsId, taskId: entry.taskId! }), location.origin).href);
          notice = 'Discussion link copied';
          break;
      }
    } catch (error) {
      failed = true;
      notice = `Could not complete action: ${(error as Error).message}`;
    } finally {
      pending = false;
    }
  }

  function navigate(event: KeyboardEvent) {
    // Escape must close only the palette, not the diff underneath it.
    if (event.key === 'Escape') event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length) selected = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (results[active]) choose(results[active]);
    }
  }
</script>

<svelte:window onkeydown={shortcut} />

{#if notice}
  <div class="notice" class:failed role="status">
    <span>{notice}</span><button aria-label="Dismiss notification" onclick={() => (notice = '')}>×</button>
  </div>
{/if}

<dialog bind:this={dialog} aria-label="Search discussions and machines" onclose={() => (open = false)}
  onclick={(event) => { if (event.target === dialog) dialog.close(); }}>
  <div class="palette">
    <div class="search">
      <svg class="search-icon" width="14" height="14" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="7.6" cy="7.6" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M11.8 11.8L16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
      <input bind:this={input} bind:value={query} oninput={() => (selected = 0)} onkeydown={navigate}
        role="combobox" aria-label="Search discussions and machines" aria-expanded={open}
        aria-autocomplete="list" aria-controls="palette-results"
        aria-activedescendant={results.length ? `palette-option-${active}` : undefined}
        placeholder="Search actions, discussions or machines…" autocomplete="off" />
      <button class="escape" aria-label="Close command palette" onclick={() => dialog.close()}>esc</button>
    </div>
    {#if (store && !store.loaded) || store?.error || !results.length}
      <div class="status" aria-live="polite">
        {#if store && !store.loaded}Loading discussions…{/if}
        {#if store?.error}Could not refresh discussions. {store.error}{/if}
        {#if !results.length && (!store || store.loaded)}No results{/if}
      </div>
    {/if}
    <div id="palette-results" role="listbox" aria-label="Results">
      {#each results as entry, index (`${entry.kind}/${entry.action ?? ''}/${entry.wsId}/${entry.taskId ?? ''}`)}
        {#if !query.trim() && (index === 0 || results[index - 1].kind !== entry.kind)}
          <div class="heading" role="presentation">{labels[entry.kind]}</div>
        {/if}
        <button id="palette-option-{index}" role="option" aria-selected={active === index}
          tabindex="-1" class:active={active === index} onpointerdown={(event) => event.preventDefault()}
          onclick={() => choose(entry)} title={[entry.title, metadata(entry)].filter(Boolean).join(' · ')}>
          <span class="dot-slot" aria-hidden="true"><span class="result-dot" style:background={dotColor(entry)}></span></span>
          <span class="row-title">{entry.title}</span>
          <span class="row-meta">{query.trim() ? `${labels[entry.kind]}${metadata(entry) ? ' · ' : ''}` : ''}{metadata(entry)}</span>
        </button>
      {/each}
    </div>
    <div class="help">
      <span><kbd>↑↓</kbd> Navigate</span>
      <span><kbd>↵</kbd> Open</span>
      <span><kbd>esc</kbd> Close</span>
      <span class="result-count">{results.length} {results.length === 1 ? 'result' : 'results'}</span>
    </div>
  </div>
</dialog>

<style>
  .notice { position: fixed; bottom: calc(var(--safe-bottom) + 20px); left: 50%; transform: translateX(-50%); z-index: 100; display: flex; align-items: center; gap: 16px; max-width: calc(100vw - 32px); padding: 12px 16px; border-radius: 10px; background: var(--surface); box-shadow: 0 4px 24px #0003; font-size: 13px; }
  .notice.failed { color: var(--red); }
  .notice button { padding: 4px; }
  dialog {
    padding: 0;
    border: 0;
    border-radius: 12px;
    background: #fbfaf8;
    color: var(--ink);
    width: min(540px, calc(100vw - 24px));
    max-height: calc(100dvh - 108px);
    margin: 84px auto auto;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .09), 0 18px 48px rgba(0, 0, 0, .2);
  }
  dialog[open] { animation: palette-in .16s cubic-bezier(.22, .8, .3, 1) both; }
  dialog::backdrop { background: rgba(34, 32, 28, .14); }
  .palette { display: flex; flex-direction: column; max-height: min(452px, calc(100dvh - 108px)); }
  .search { flex: none; display: flex; align-items: center; gap: 10px; padding: 0 12px; height: 42px; border-bottom: 1px solid rgba(0, 0, 0, .06); }
  .search-icon { flex: none; color: var(--muted-3); }
  input { flex: 1; min-width: 0; border: 0; outline: none; padding: 0; background: transparent; color: inherit; font: inherit; font-size: 13.5px; }
  input::placeholder { color: var(--muted-3); }
  .escape { flex: none; padding: 2px 6px; border-radius: 5px; color: var(--muted-3); font-family: var(--mono); font-size: 10.5px; box-shadow: 0 0 0 1px rgba(0, 0, 0, .07); }
  .escape:hover { background: rgba(0, 0, 0, .04); }
  .escape:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  #palette-results { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding: 6px 0; }
  .heading { padding: 8px 14px 4px; color: #a09d94; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  [role='option'] { display: flex; align-items: center; gap: 9px; width: calc(100% - 12px); margin: 0 6px; padding: 6px 8px; border-radius: 8px; text-align: left; }
  [role='option'].active, [role='option']:hover { background: rgba(0, 0, 0, .06); }
  .dot-slot { width: 7px; flex: none; display: flex; justify-content: center; }
  .result-dot { width: 6px; height: 6px; border-radius: 50%; }
  .row-title, .row-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-title { flex: 1; font-size: 13.5px; }
  .row-meta { flex: 0 1 auto; max-width: 45%; font-size: 11.5px; color: var(--muted-2); }
  .row-meta:empty { display: none; }
  .status { flex: none; padding: 24px 14px; text-align: center; font-size: 12.5px; color: var(--muted-3); overflow-wrap: anywhere; }
  .help { flex: none; display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-top: 1px solid rgba(0, 0, 0, .06); background: #f7f6f3; font-size: 11.5px; color: #a09d94; }
  .help > span { white-space: nowrap; }
  kbd { font: inherit; }
  .result-count { margin-left: auto; }
  @keyframes palette-in {
    from { transform: translateY(-6px) scale(.99); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
  @media (max-width: 600px), (max-height: 500px) {
    dialog { margin-top: calc(var(--safe-top) + 24px); max-height: calc(100dvh - var(--safe-top) - var(--safe-bottom) - 48px); }
    .palette { max-height: min(452px, calc(100dvh - var(--safe-top) - var(--safe-bottom) - 48px)); }
    .help { gap: 10px; padding-inline: 12px; font-size: 10.5px; }
  }
  @media (pointer: coarse) {
    .search { height: 48px; }
    .escape { min-height: 28px; min-width: 32px; }
    [role='option'] { min-height: 44px; }
  }
  @media (prefers-reduced-motion: reduce) {
    dialog[open] { animation: none; }
  }
</style>
