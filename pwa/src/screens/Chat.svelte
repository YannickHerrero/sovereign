<script lang="ts">
  import Composer from '../components/Composer.svelte';
  import DiffSheet from '../components/DiffSheet.svelte';
  import Icon from '../components/Icon.svelte';
  import Thread from '../components/Thread.svelte';
  import { ChatSession } from '../lib/chat.svelte';
  import { router } from '../lib/router.svelte';
  import type { WorkspaceStore } from '../lib/workspace.svelte';

  let { store, taskId }: { store: WorkspaceStore; taskId: string } = $props();

  // The parent keys this component by task id, so a session per instance is intended.
  // svelte-ignore state_referenced_locally
  const session = new ChatSession(store, taskId);
  let menuOpen = $state(false);

  const summary = $derived(session.summary);

  $effect(() => session.start());

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
    if (!window.confirm('Delete this task? The agent’s session file is kept on the machine.')) return;
    if (await session.remove()) router.replace({ name: 'tasks', wsId: store.server.id });
  }
</script>

<div class="screen screen--slide">
  <div class="topbar">
    <button class="round round--raised" aria-label="Back" onclick={() => router.back({ name: 'tasks', wsId: store.server.id })}>
      <Icon name="back" color="var(--ink-icon)" />
    </button>
    <div class="crumb">{summary ? `${summary.repo} · ${summary.title}` : ''}</div>
    <button class="round round--raised" aria-label="Menu" onclick={() => (menuOpen = !menuOpen)}>
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

  <Thread {session} />

  {#if session.touched.length}
    <div class="pr-wrap">
      <button class="pr" onclick={() => session.openDiff()}>
        <Icon name="pr" color="#6b675f" />
        <span>View diff</span>
        <span class="plus">+{session.totalPlus}</span>
        <span class="minus">-{session.totalMinus}</span>
      </button>
    </div>
  {/if}

  <Composer
    placeholder="Follow up…"
    repo={summary?.repo ?? ''}
    branch={session.detail?.branch}
    model={session.detail?.model}
    agent={summary?.agent}
    draftKey="{store.server.id}/{taskId}"
    captureTyping
    typingBlocked={() => menuOpen || session.diffOpen}
    loadModels={() => session.models()}
    onModelChange={(model) => session.changeModel(model)}
    modelDisabled={session.working}
    onSubmit={(text, images) => session.send(text, images)}
  />

  {#if session.diffOpen}
    <DiffSheet files={session.diffFiles} loading={session.diffLoading} onClose={() => session.closeDiff()} />
  {/if}
</div>

<style>
  .topbar {
    padding-bottom: 4px;
  }
  .crumb {
    flex: 1;
    text-align: center;
    font-size: 12.5px;
    color: var(--muted-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 10px;
  }
  .menu-backdrop {
    position: absolute;
    inset: 0;
    z-index: 34;
    cursor: default;
  }
  .menu {
    position: absolute;
    top: calc(var(--safe-top) + 54px);
    right: 16px;
    z-index: 35;
    background: var(--surface);
    border-radius: 14px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px var(--hairline);
    padding: 6px;
    display: flex;
    flex-direction: column;
    min-width: 150px;
    animation: fadeUp 0.16s ease both;
  }
  .menu button {
    text-align: left;
    padding: 10px 12px;
    border-radius: 9px;
    font-size: 14px;
  }
  .menu button:active {
    background: var(--press);
  }
  .menu .danger {
    color: var(--red);
  }
  .pr-wrap {
    position: absolute;
    left: 20px;
    bottom: calc(var(--safe-bottom) + 88px);
    z-index: 20;
  }
  .pr {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border-radius: 999px;
    padding: 8px 14px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.09);
    font-size: 13px;
    color: var(--ink-body);
  }
  .pr:active {
    background: #f4f2ee;
  }
</style>
