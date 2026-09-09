<script lang="ts">
  import { tick } from 'svelte';
  import Composer from '../components/Composer.svelte';
  import DiffSheet from '../components/DiffSheet.svelte';
  import Icon from '../components/Icon.svelte';
  import { api } from '../lib/api';
  import { ago } from '../lib/format';
  import { blocks } from '../lib/markdown';
  import { router } from '../lib/router.svelte';
  import type { ImageContent, FileDiff, RunEvent, TaskDetail, TouchedFile, Turn } from '../lib/types';
  import type { WorkspaceStore } from '../lib/workspace.svelte';

  let { store, taskId }: { store: WorkspaceStore; taskId: string } = $props();

  interface Live {
    status: string;
    text: string;
    files: string[];
  }

  let detail = $state<TaskDetail | null>(null);
  let turns = $state<Turn[]>([]);
  let live = $state<Live | null>(null);
  let error = $state<string | null>(null);
  let menuOpen = $state(false);
  let diffOpen = $state(false);
  let diffFiles = $state<FileDiff[]>([]);
  let diffLoading = $state(false);
  let scroller = $state<HTMLDivElement | null>(null);
  let now = $state(Date.now());

  const summary = $derived(store.task(taskId) ?? detail);
  const working = $derived(summary?.state === 'working' || live !== null);
  const touched = $derived<TouchedFile[]>(detail?.touched_files ?? []);
  const totalPlus = $derived(touched.reduce((a, f) => a + f.plus, 0));
  const totalMinus = $derived(touched.reduce((a, f) => a + f.minus, 0));
  const lastAgentIndex = $derived(turns.map((t) => t.role).lastIndexOf('agent'));

  $effect(() => store.acquire());

  $effect(() => {
    void load();
    const timer = setInterval(() => (now = Date.now()), 30000);
    return () => clearInterval(timer);
  });

  $effect(() =>
    store.onRun((id, event) => {
      if (id === taskId) handle(event);
    }),
  );

  async function load() {
    try {
      detail = await api.task(store.server, taskId);
      turns = detail.turns;
      const first = store.firstPrompt(taskId);
      if (turns.length === 0 && first) turns = [{ role: 'user', ...first, at: detail.created_at }];
      error = null;
      if (detail.state === 'working' && !live) live = { status: 'Working…', text: '', files: [] };
      await scrollToEnd();
    } catch (err) {
      error = (err as Error).message;
    }
  }

  function handle(event: RunEvent) {
    switch (event.kind) {
      case 'agent_start':
        live = { status: 'Thinking…', text: '', files: [] };
        break;
      case 'status':
        if (live) live.status = event.text;
        break;
      case 'text_delta':
        if (!live) live = { status: 'Writing…', text: '', files: [] };
        live.text += event.delta;
        break;
      case 'file_touched':
        if (live && !live.files.includes(event.path)) live.files.push(event.path);
        break;
      case 'settled':
        live = null;
        turns.push(event.turn);
        void refreshStats();
        break;
      case 'error':
        error = event.message;
        break;
      case 'ui_request':
        break;
    }
    void scrollToEnd();
  }

  async function refreshStats() {
    try {
      const fresh = await api.task(store.server, taskId);
      detail = fresh;
      turns = fresh.turns;
    } catch {
      // Keep what we have.
    }
  }

  async function scrollToEnd() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  async function send(text: string, images: ImageContent[]) {
    error = null;
    const optimistic: Turn = { role: 'user', text, images, at: Date.now() };
    turns.push(optimistic);
    void scrollToEnd();
    try {
      await api.prompt(store.server, taskId, text, images);
    } catch (err) {
      turns = turns.filter((t) => t !== optimistic);
      error = (err as Error).message;
      throw err;
    }
  }

  async function openDiff() {
    diffOpen = true;
    diffLoading = true;
    try {
      diffFiles = (await api.diff(store.server, taskId)).files;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      diffLoading = false;
    }
  }

  async function togglePin() {
    menuOpen = false;
    if (!summary) return;
    try {
      store.upsert(await api.patchTask(store.server, taskId, { pinned: !summary.pinned }));
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function rename() {
    menuOpen = false;
    const title = window.prompt('Task title', summary?.title ?? '');
    if (!title || !title.trim()) return;
    try {
      store.upsert(await api.patchTask(store.server, taskId, { title: title.trim() }));
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function abort() {
    menuOpen = false;
    try {
      await api.abort(store.server, taskId);
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function remove() {
    menuOpen = false;
    if (!window.confirm('Delete this task? The pi session file is kept on the machine.')) return;
    try {
      await api.deleteTask(store.server, taskId);
      store.remove(taskId);
      router.replace({ name: 'tasks', wsId: store.server.id });
    } catch (err) {
      error = (err as Error).message;
    }
  }

  function metaLabel(turn: Extract<Turn, { role: 'agent' }>): string {
    const when = ago(turn.at, now);
    const word = turn.status === 'settled' ? 'Finished' : turn.status === 'aborted' ? 'Stopped' : 'Failed';
    return when === 'now' ? `${word} now` : `${word} ${when}`;
  }

  function statsFor(path: string): TouchedFile | undefined {
    return touched.find((f) => f.path === path);
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
      <button onclick={togglePin}>{summary?.pinned ? 'Unpin' : 'Pin'}</button>
      <button onclick={rename}>Rename</button>
      {#if working}
        <button onclick={abort}>Stop agent</button>
      {/if}
      <button class="danger" onclick={remove}>Delete</button>
    </div>
  {/if}

  <div class="scroll thread" bind:this={scroller}>
    {#each turns as turn, index (index)}
      {#if turn.role === 'user'}
        <div class="user">
          {#each turn.images ?? [] as image}
            <img class="message-image" src={`data:${image.mimeType};base64,${image.data}`} alt="Attachment" />
          {/each}
          {turn.text}
        </div>
      {:else}
        <div class="agent">
          <div class="meta">{metaLabel(turn)}</div>
          {#each blocks(turn.text) as block}
            {#if block.kind === 'heading'}
              <div class="heading">{@html block.html}</div>
            {:else if block.kind === 'paragraph'}
              <p>{@html block.html}</p>
            {:else if block.kind === 'list'}
              <ul>
                {#each block.items ?? [] as item}
                  <li>{@html item}</li>
                {/each}
              </ul>
            {:else}
              <pre>{@html block.html}</pre>
            {/if}
          {/each}
          {#if turn.status === 'error' && !turn.text}
            <p class="failed">The agent stopped with an error.</p>
          {/if}
          {#if turn.files.length}
            <div class="files">
              {#each turn.files as path (path)}
                {@const stats = index === lastAgentIndex ? statsFor(path) : undefined}
                <div class="file">
                  <span class="path">{path}</span>
                  {#if stats}
                    <span class="stats"><span class="plus">+{stats.plus}</span><span class="minus">-{stats.minus}</span></span>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    {/each}

    {#if live}
      <div class="agent">
        {#if live.text}
          {#each blocks(live.text) as block}
            {#if block.kind === 'paragraph'}
              <p>{@html block.html}</p>
            {:else if block.kind === 'heading'}
              <div class="heading">{@html block.html}</div>
            {:else if block.kind === 'list'}
              <ul>
                {#each block.items ?? [] as item}
                  <li>{@html item}</li>
                {/each}
              </ul>
            {:else}
              <pre>{@html block.html}</pre>
            {/if}
          {/each}
        {/if}
        <div class="working">
          <span class="dot dot--pulse"></span>
          <span class="shimmer">{live.status}</span>
        </div>
      </div>
    {/if}

    {#if error}
      <div class="error">{error}</div>
    {/if}
  </div>

  {#if touched.length}
    <div class="pr-wrap">
      <button class="pr" onclick={openDiff}>
        <Icon name="pr" color="#6b675f" />
        <span>View diff</span>
        <span class="plus">+{totalPlus}</span>
        <span class="minus">-{totalMinus}</span>
      </button>
    </div>
  {/if}

  <Composer placeholder="Follow up…" repo={summary?.repo ?? ''} branch={detail?.branch} model={detail?.model} onSubmit={send} />

  {#if diffOpen}
    <DiffSheet files={diffFiles} loading={diffLoading} onClose={() => (diffOpen = false)} />
  {/if}
</div>

<style>
  .message-image {
    display: block;
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
    border-radius: 10px;
    margin-bottom: 8px;
  }
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
  .thread {
    padding: 14px 20px calc(var(--safe-bottom) + 130px);
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .user {
    align-self: flex-end;
    max-width: 80%;
    background: var(--bubble);
    border-radius: 19px;
    padding: 11px 15px;
    font-size: 14.5px;
    line-height: 1.45;
    color: var(--ink);
    white-space: pre-wrap;
    animation: fadeUp 0.22s ease both;
  }
  .agent {
    animation: fadeUp 0.24s ease both;
  }
  .meta {
    font-size: 12.5px;
    color: #a19e96;
    margin-bottom: 5px;
  }
  .heading {
    font-size: 15.5px;
    font-weight: 600;
    color: var(--ink-strong);
    letter-spacing: -0.2px;
    margin-bottom: 6px;
  }
  .agent p,
  .agent ul {
    margin: 0 0 11px;
    font-size: 14.5px;
    line-height: 1.5;
    color: var(--ink-body);
  }
  .agent ul {
    padding-left: 20px;
  }
  .agent :global(code) {
    font-family: var(--mono);
    font-size: 12.5px;
    background: var(--press);
    padding: 1px 5px;
    border-radius: 5px;
  }
  .agent pre {
    margin: 0 0 11px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--press);
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.5;
    overflow-x: auto;
  }
  .failed {
    color: var(--red);
  }
  .files {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    border-radius: 12px;
    overflow: hidden;
    background: var(--hairline);
  }
  .file {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
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
  .working {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .shimmer {
    font-size: 14px;
    background: linear-gradient(90deg, #b3b0a8 0%, #3a382f 45%, #b3b0a8 90%);
    background-size: 220% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmerText 1.7s linear infinite;
  }
  .error {
    font-size: 12.5px;
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
