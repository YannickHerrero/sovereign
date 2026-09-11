<script lang="ts">
  import { tick } from 'svelte';
  import { layout } from '../lib/layout.svelte';
  import { paletteEntries, searchPalette, type PaletteEntry } from '../lib/palette';
  import { router } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';
  import { workspaceStore } from '../lib/workspace.svelte';

  let dialog: HTMLDialogElement;
  let input: HTMLInputElement;
  let open = $state(false);
  let query = $state('');
  let selected = $state(0);
  const route = $derived(router.route);
  const wsId = $derived('wsId' in route ? route.wsId : layout.desktop ? settings.servers[0]?.id : undefined);
  const store = $derived(wsId ? workspaceStore(wsId) : undefined);
  const matches = $derived(searchPalette(paletteEntries(store?.tasks ?? [], settings.servers, wsId), query));
  // Keep the two sections contiguous, with relevance ordering within each section.
  const results = $derived([...matches.filter((e) => e.kind === 'discussion'), ...matches.filter((e) => e.kind === 'machine')]);
  const active = $derived(Math.min(selected, Math.max(0, results.length - 1)));

  $effect(() => { if (open && store) return store.acquire(); });
  $effect(() => {
    if (open) document.getElementById(`palette-option-${active}`)?.scrollIntoView({ block: 'nearest' });
  });

  export async function show() {
    if (dialog.open || document.querySelector('dialog[open]')) return;
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

  function choose(entry: PaletteEntry) {
    dialog.close();
    router.go(entry.kind === 'discussion'
      ? { name: 'chat', wsId: entry.wsId, taskId: entry.taskId! }
      : { name: 'tasks', wsId: entry.wsId });
  }

  function navigate(event: KeyboardEvent) {
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

<dialog bind:this={dialog} aria-label="Search discussions and machines" onclose={() => (open = false)}
  onclick={(event) => { if (event.target === dialog) dialog.close(); }}>
  <div class="palette">
    <div class="search">
      <input bind:this={input} bind:value={query} oninput={() => (selected = 0)} onkeydown={navigate}
        role="combobox" aria-label="Search discussions and machines" aria-expanded={open}
        aria-autocomplete="list" aria-controls="palette-results"
        aria-activedescendant={results.length ? `palette-option-${active}` : undefined}
        placeholder="Search discussions or machines…" autocomplete="off" />
      <button aria-label="Close command palette" onclick={() => dialog.close()}>Esc</button>
    </div>
    <div class="status" aria-live="polite">
      {#if store && !store.loaded}Loading discussions…{/if}
      {#if store?.error}Could not refresh discussions. {store.error}{/if}
      {#if !results.length && (!store || store.loaded)}No results{/if}
    </div>
    <div id="palette-results" role="listbox" aria-label="Results">
      {#each ['discussion', 'machine'] as kind}
        {#if results.some((entry) => entry.kind === kind)}
          <div role="group" aria-label={kind === 'discussion' ? 'Discussions' : 'Machines'}>
            <div class="heading" aria-hidden="true">{kind === 'discussion' ? 'Discussions' : 'Machines'}</div>
            {#each results as entry, index (`${entry.kind}/${entry.wsId}/${entry.taskId ?? ''}`)}
              {#if entry.kind === kind}
                <button id="palette-option-{index}" role="option" aria-selected={active === index}
                  tabindex="-1" class:active={active === index} onpointerdown={(event) => event.preventDefault()}
                  onclick={() => choose(entry)}>
                  <span class="title">{entry.title}</span>
                  <span class="subtitle">{entry.subtitle}</span>
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      {/each}
    </div>
    <div class="help">↑ ↓ Navigate · Enter Open · Esc Close</div>
  </div>
</dialog>

<style>
  dialog { padding: 0; border: 1px solid var(--hairline); border-radius: 16px; background: var(--surface); color: var(--ink); width: min(560px, calc(100vw - 24px)); max-height: 80dvh; margin: 12dvh auto auto; box-shadow: 0 20px 70px #0003; }
  dialog::backdrop { background: rgba(30, 28, 24, 0.35); }
  .palette { display: flex; flex-direction: column; max-height: 75dvh; }
  .search { display: flex; align-items: center; gap: 8px; padding: 16px; border-bottom: 1px solid var(--hairline); }
  input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: inherit; font: inherit; font-size: 16px; }
  .search button { padding: 4px 6px; border-radius: 5px; background: var(--press); font-size: 12px; }
  #palette-results { overflow-y: auto; padding: 6px; }
  .heading { padding: 10px; color: var(--muted-2); font-size: 11px; text-transform: uppercase; letter-spacing: .6px; }
  [role='option'] { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 10px; border-radius: 8px; text-align: left; }
  [role='option'].active, [role='option']:hover { background: var(--press); }
  .title, .subtitle { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title { font-size: 14px; }
  .subtitle, .help, .status { font-size: 12px; color: var(--muted-2); }
  .status:empty { display: none; }
  .status { padding: 12px 16px; }
  .help { padding: 12px 16px; border-top: 1px solid var(--hairline); }
</style>
