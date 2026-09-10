<script lang="ts">
  import DockedComposer from '../../components/DockedComposer.svelte';
  import Icon from '../../components/Icon.svelte';
  import Thread from '../../components/Thread.svelte';
  import { ChatSession } from '../../lib/chat.svelte';
  import { router } from '../../lib/router.svelte';
  import type { WorkspaceStore } from '../../lib/workspace.svelte';
  import DiffPanel from './DiffPanel.svelte';

  let { store, taskId, onModel }: { store: WorkspaceStore; taskId: string; onModel: (model: string | null) => void } = $props();

  // The parent keys this component by task id, so a session per instance is intended.
  // svelte-ignore state_referenced_locally
  const session = new ChatSession(store, taskId);
  let menuOpen = $state(false);

  const summary = $derived(session.summary);

  $effect(() => session.start());
  $effect(() => onModel(session.detail?.model ?? null));

  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (session.diffOpen) session.closeDiff();
      menuOpen = false;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function pin() {
    menuOpen = false;
    void session.togglePin();
  }

  function stop() {
    menuOpen = false;
    void session.abort();
  }

  function rename() {
    menuOpen = false;
    const title = window.prompt('Task title', summary?.title ?? '');
    if (title) void session.rename(title);
  }

  async function remove() {
    menuOpen = false;
    if (!window.confirm('Delete this task? The pi session file is kept on the machine.')) return;
    if (await session.remove()) router.replace({ name: 'tasks', wsId: store.server.id });
  }
</script>

<div class="pane">
  <div class="head">
    <div class="task-title">{summary?.title ?? ''}</div>
    <div class="meta">{summary ? `${summary.repo}${session.detail?.branch ? ` · ${session.detail.branch}` : ''}` : ''}</div>
    {#if session.touched.length}
      <button class="chip" onclick={() => session.openDiff()}>
        <span>View diff</span>
        <span class="plus">+{session.totalPlus}</span>
        <span class="minus">-{session.totalMinus}</span>
      </button>
    {/if}
    <button class="more" aria-label="Menu" onclick={() => (menuOpen = !menuOpen)}>
      <Icon name="dots" color="var(--ink-icon)" />
    </button>
  </div>

  {#if menuOpen}
    <button class="menu-backdrop" aria-label="Close menu" onclick={() => (menuOpen = false)}></button>
    <div class="menu">
      <button onclick={pin}>{summary?.pinned ? 'Unpin' : 'Pin'}</button>
      <button onclick={rename}>Rename</button>
      {#if session.working}
        <button onclick={stop}>Stop agent</button>
      {/if}
      <button class="danger" onclick={remove}>Delete</button>
    </div>
  {/if}

  <Thread {session} variant="desktop" />

  <DockedComposer
    placeholder="Follow up…"
    repo={summary?.repo ?? ''}
    branch={session.detail?.branch}
    model={session.detail?.model}
    agent={summary?.agent}
    loadModels={() => session.models()}
    onModelChange={(model) => session.changeModel(model)}
    modelDisabled={session.working}
    onSubmit={(text, images) => session.send(text, images)}
  />

  {#if session.diffOpen}
    <DiffPanel files={session.diffFiles} loading={session.diffLoading} onClose={() => session.closeDiff()} />
  {/if}
</div>

<style>
  .pane {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: #fbfaf8;
    overflow: hidden;
  }
  .head {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px 0 20px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .task-title {
    min-width: 0;
    flex: 1;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 12px;
    color: var(--muted-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--surface);
    border-radius: 8px;
    padding: 5px 11px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
    font-size: 12.5px;
    color: var(--ink-body);
    white-space: nowrap;
    flex: none;
  }
  .chip:hover {
    background: #f4f2ee;
  }
  .more {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .more:hover {
    background: var(--press);
  }
  .menu-backdrop {
    position: absolute;
    inset: 0;
    z-index: 34;
    cursor: default;
  }
  .menu {
    position: absolute;
    top: 42px;
    right: 12px;
    z-index: 35;
    background: var(--surface);
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--hairline);
    padding: 5px;
    display: flex;
    flex-direction: column;
    min-width: 150px;
    animation: fadeUp 0.16s ease both;
  }
  .menu button {
    text-align: left;
    padding: 7px 10px;
    border-radius: 7px;
    font-size: 13px;
  }
  .menu button:hover {
    background: var(--press);
  }
  .menu .danger {
    color: var(--red);
  }
</style>
