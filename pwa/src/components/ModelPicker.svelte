<script lang="ts">
  import { AGENT_LABEL, type AgentKind, type Model, type ModelList } from '../lib/types';
  import Icon from './Icon.svelte';

  let { model = null, agent = null, loadModels, onModelChange, disabled = false, busy = $bindable(false) }: {
    model?: string | null;
    /** Agent of the current task, shown next to the model name. */
    agent?: AgentKind | null;
    loadModels: () => Promise<ModelList>;
    onModelChange: (model: Model) => Promise<void> | void;
    disabled?: boolean;
    busy?: boolean;
  } = $props();

  /** Short tag shown on each row: the agent for Claude Code, the pi provider otherwise. */
  function tag(m: Model): string {
    return m.agent === 'claude' ? AGENT_LABEL.claude : m.provider;
  }

  let dialog: HTMLDialogElement;
  let list = $state<ModelList | null>(null);
  let error = $state<string | null>(null);
  let query = $state('');
  const filtered = $derived((list?.models ?? []).filter((m) =>
    `${m.agent} ${tag(m)} ${m.provider} ${m.id} ${m.name}`.toLowerCase().includes(query.toLowerCase())));

  async function load() {
    busy = true;
    error = null;
    list = null;
    try {
      list = await loadModels();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }

  function open() {
    query = '';
    dialog.showModal();
    void load();
  }

  async function select(model: Model) {
    if (busy || disabled) return;
    busy = true;
    error = null;
    try {
      await onModelChange(model);
      dialog.close();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<button class="trigger" aria-label="Choose model" title={disabled ? 'Wait for the current operation to finish' : 'Choose model'}
  disabled={disabled || busy} onclick={open}>
  <span>{agent === 'claude' ? `Claude · ${model || 'default'}` : (model || 'Default model')}</span>
  <Icon name="chevron" color="var(--muted-3)" />
</button>

<dialog bind:this={dialog} aria-label="Choose model">
  <div class="head">
    <strong>Choose model</strong>
    <button class="round" aria-label="Close model picker" onclick={() => dialog.close()}><Icon name="close" /></button>
  </div>
  <input class="search" aria-label="Search models" placeholder="Search models or providers…" bind:value={query} />
  {#if error}
    <div class="error" role="alert">{error}</div>
    {#if !list}<button class="retry" disabled={busy} onclick={load}>Retry</button>{/if}
  {/if}
  {#if busy}<div class="note" role="status">{list ? 'Changing model…' : 'Loading models…'}</div>{/if}
  <div class="options">
    {#each filtered as option (`${option.agent}/${option.provider}/${option.id}`)}
      <button class="option" disabled={busy || disabled} onclick={() => select(option)}
        aria-pressed={list?.current?.agent === option.agent && list?.current?.provider === option.provider && list?.current?.id === option.id}>
        <span class="top">
          <span class="name">{option.name || option.id}</span>
          <span class="tag" class:claude={option.agent === 'claude'}>{tag(option)}</span>
        </span>
        <span class="id">{option.id}{option.input.includes('image') ? ' · Images' : ''}</span>
      </button>
    {/each}
    {#if list && !filtered.length}
      <div class="note">{list.models.length ? 'No matching models.' : 'No available models. Sign in to pi or Claude Code on this machine.'}</div>
    {/if}
  </div>
</dialog>

<style>
  .trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 5px 0;
    color: var(--ink-control);
    font-size: 13px;
  }
  .trigger span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button:disabled { opacity: 0.5; }
  dialog {
    width: min(480px, calc(100vw - 28px));
    max-height: 70dvh;
    padding: 16px;
    border: 0;
    border-radius: 18px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 12px 50px rgba(0, 0, 0, 0.2);
  }
  dialog[open] { display: flex; flex-direction: column; gap: 12px; }
  dialog::backdrop { background: rgba(30, 28, 24, 0.3); }
  .head { display: flex; align-items: center; justify-content: space-between; flex: none; }
  .search { width: 100%; padding: 10px; border: 1px solid var(--muted-5); border-radius: 9px; background: var(--bg); flex: none; }
  .options { overflow-y: auto; min-height: 0; }
  .option { display: flex; flex-direction: column; gap: 4px; width: 100%; padding: 10px; border-radius: 9px; text-align: left; }
  .option:hover, .option[aria-pressed='true'] { background: var(--press); }
  .option[aria-pressed='true'] .name { color: var(--accent); }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .name { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { flex: none; font-size: 11px; color: var(--muted-2); background: var(--press); border-radius: 999px; padding: 2px 8px; }
  .tag.claude { color: var(--accent); background: rgba(44, 111, 187, 0.1); }
  .id { font-size: 11px; color: var(--muted-2); overflow-wrap: anywhere; }
  .note, .error { font-size: 13px; padding: 8px 0; }
  .note { color: var(--muted-2); }
  .error { color: var(--red); }
  .retry { color: var(--accent); text-align: left; }
</style>
