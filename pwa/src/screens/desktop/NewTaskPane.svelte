<script lang="ts">
  import DockedComposer from '../../components/DockedComposer.svelte';
  import { api } from '../../lib/api';
  import { router } from '../../lib/router.svelte';
  import type { ImageContent, PiModel, Repo } from '../../lib/types';
  import type { WorkspaceStore } from '../../lib/workspace.svelte';

  let { store }: { store: WorkspaceStore } = $props();

  let repos = $state<Repo[]>([]);
  let repo = $state('');
  let selectedModel = $state<PiModel | null>(null);
  let error = $state<string | null>(null);

  const branch = $derived(repos.find((r) => r.name === repo)?.branch ?? null);

  $effect(() => {
    api
      .repos(store.server)
      .then((list) => {
        repos = list;
        if (!list.some((r) => r.name === repo)) repo = list[0]?.name ?? '';
      })
      .catch((err: Error) => (error = err.message));
  });

  async function loadModels() {
    const list = await api.models(store.server, repo);
    return { ...list, current: selectedModel ?? list.current };
  }

  async function create(message: string, images: ImageContent[]) {
    if (!repo) {
      error = 'Choose a repo first';
      throw new Error(error);
    }
    error = null;
    try {
      const task = await api.createTask(store.server, repo, message, images, selectedModel);
      store.upsert(task);
      store.rememberFirstPrompt(task.id, message, images);
      router.go({ name: 'chat', wsId: store.server.id, taskId: task.id });
    } catch (err) {
      error = (err as Error).message;
      throw err;
    }
  }
</script>

<div class="pane">
  <div class="head">
    <div class="task-title">New task</div>
    <div class="meta">{store.server.name}</div>
  </div>
  <div class="body">
    <div class="hint">
      <p>Describe what to plan, ask or build in <strong>{repo || 'a repo'}</strong>.</p>
      <p class="sub">{selectedModel?.agent === 'claude' ? 'Claude Code' : 'pi'} runs on {store.server.name} and streams its progress here.</p>
      {#if error}<p class="error">{error}</p>{/if}
    </div>
  </div>
  <DockedComposer placeholder="Plan, ask, build…" {repo} {branch} {repos}
    onRepoChange={(name) => { repo = name; selectedModel = null; }}
    model={selectedModel?.id} agent={selectedModel?.agent} {loadModels} onModelChange={(model) => { selectedModel = model; }}
    modelDisabled={!repo} onSubmit={create} autofocus captureTyping />
</div>

<style>
  .pane {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: #fbfaf8;
  }
  .head {
    height: 44px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 20px;
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .task-title {
    flex: 1;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink);
  }
  .meta {
    font-size: 12px;
    color: var(--muted-2);
  }
  .body {
    flex: 1;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .hint {
    max-width: 720px;
    width: 100%;
    padding: 0 28px 8px;
    font-size: 14px;
    color: var(--ink-body);
  }
  .hint p {
    margin: 0 0 6px;
  }
  .sub {
    font-size: 12.5px;
    color: var(--muted-2);
  }
  .error {
    font-size: 12.5px;
    color: var(--red);
  }
</style>
