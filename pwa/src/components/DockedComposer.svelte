<script lang="ts">
  import { tick } from 'svelte';
  import { ComposerState, isSubmitShortcut, type SubmitHandler } from '../lib/composer.svelte';
  import { shouldCapture, shouldCapturePaste } from '../lib/typeahead';
  import type { AgentKind, ModelList, PiModel, Repo } from '../lib/types';
  import ModelPicker from './ModelPicker.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    placeholder: string;
    repo: string;
    branch?: string | null;
    model?: string | null;
    agent?: AgentKind | null;
    loadModels: () => Promise<ModelList>;
    onModelChange: (model: PiModel) => Promise<void> | void;
    modelDisabled?: boolean;
    /** When given, the repo chip becomes a picker (new task). */
    repos?: Repo[];
    onRepoChange?: (name: string) => void;
    onSubmit: SubmitHandler;
    /** Route keystrokes and pastes made outside any field into this composer. */
    captureTyping?: boolean;
    /** Page-level overlays (menu, diff) that must keep stray keystrokes for themselves. */
    typingBlocked?: () => boolean;
    /** Drop the 720px column and span the pane. */
    wide?: boolean;
    autofocus?: boolean;
  }

  let {
    placeholder, repo, branch = null, model = null, agent = null, loadModels, onModelChange, modelDisabled = false,
    repos, onRepoChange, onSubmit, autofocus = false, captureTyping = false, typingBlocked = () => false, wide = false,
  }: Props = $props();

  const c = new ComposerState();
  let modelBusy = $state(false);
  let imageInput: HTMLInputElement;
  let textarea = $state<HTMLTextAreaElement | null>(null);

  $effect(() => () => c.dispose());

  $effect(() => {
    if (autofocus) void focusEnd();
  });

  $effect(() => {
    if (!captureTyping) return;
    const onKey = (event: KeyboardEvent) => {
      if (c.mode === 'voice' || c.sending) return;
      const char = shouldCapture(event, typingBlocked);
      if (char === null) return;
      event.preventDefault();
      c.append(char);
      void focusEnd();
    };
    const onStrayPaste = (event: ClipboardEvent) => {
      if (c.mode === 'voice' || c.sending || !shouldCapturePaste(event, typingBlocked)) return;
      event.preventDefault();
      if (c.pasteImage(event)) return;
      c.append(event.clipboardData?.getData('text/plain') ?? '');
      void focusEnd();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onStrayPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onStrayPaste);
    };
  });

  async function focusEnd() {
    await tick();
    textarea?.focus();
    textarea?.setSelectionRange(c.draft.length, c.draft.length);
  }

  async function mic() {
    const started = await c.startVoice();
    if (!started) await focusEnd();
  }

  async function stopVoice() {
    await c.stopVoice();
    await focusEnd();
  }

  function chooseImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void c.attachImage(file);
  }

  function onPaste(event: ClipboardEvent) {
    if (c.pasteImage(event)) event.preventDefault();
  }

  async function submit() {
    if (!c.hasDraft || c.busy || modelBusy) return;
    await c.submit(onSubmit);
    await focusEnd();
  }

  function onKeydown(event: KeyboardEvent) {
    if (isSubmitShortcut(event)) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<input hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" bind:this={imageInput} onchange={chooseImage} />

<div class="dock">
  <div class="card" class:wide>
    <div class="context">
      {#if repos}
        <label class="picker">
          <span class="repo">{repo || 'Choose a repo'}</span>
          <Icon name="chevron" color="var(--muted-3)" />
          <select value={repo} onchange={(e) => onRepoChange?.((e.currentTarget as HTMLSelectElement).value)}>
            <option value="" disabled>Choose a repo</option>
            {#each repos as r (r.name)}
              <option value={r.name}>{r.name}</option>
            {/each}
          </select>
        </label>
      {:else}
        <span class="repo">{repo}</span>
      {/if}
      {#if branch}
        <span class="branch">{branch}</span>
        <Icon name="chevron" color="var(--muted-3)" />
      {/if}
    </div>

    {#if c.mode === 'voice'}
      <div class="transcript">{c.transcript || (c.seconds === 0 ? 'Listening…' : '')}</div>
    {:else}
      <textarea
        bind:this={textarea}
        bind:value={c.draft}
        disabled={c.sending}
        placeholder="{placeholder}  ⌘↵ to send"
        rows="2"
        onkeydown={onKeydown}
        onpaste={onPaste}
      ></textarea>
    {/if}
    {#if c.image}
      <div class="attachment">
        <img src={`data:${c.image.mimeType};base64,${c.image.data}`} alt="Attachment preview" />
        <button disabled={c.sending} onclick={() => c.removeImage()}>Remove image</button>
      </div>
    {/if}
    {#if c.imageLoading}<div class="note">Loading image…</div>{/if}
    {#if c.imageError}<div class="note" role="alert">{c.imageError}</div>{/if}
    {#if c.voiceError}<div class="note">{c.voiceError}</div>{/if}

    <div class="bar">
      <div class="left">
        <button class="attach" aria-label="Attach image" title="Attach image" disabled={c.busy || c.mode === 'voice'} onclick={() => imageInput.click()}>
          <Icon name="plus" color="var(--ink-control)" />
        </button>
        <ModelPicker {model} {agent} {loadModels} {onModelChange} disabled={modelDisabled || c.busy || c.mode === 'voice'} bind:busy={modelBusy} />
      </div>
      {#if c.mode === 'voice'}
        <button class="record" aria-label="Stop recording" onclick={stopVoice}>
          <Icon name="stop" />
          <span class="timer">{c.timer}</span>
          <span class="wave"><i></i><i></i><i></i><i></i></span>
        </button>
      {:else}
        <div class="right">
          <button class="mic" aria-label="Voice" onclick={mic}>
            <Icon name="mic" color="var(--ink-control)" />
          </button>
          <button class="send" class:ready={c.hasDraft && !c.busy && !modelBusy} aria-label="Send" disabled={!c.hasDraft || c.busy || modelBusy} onclick={submit}>
            <Icon name="send" color="#fff" />
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .dock {
    flex: none;
    padding: 14px 28px 22px;
  }
  .card.wide {
    max-width: none;
  }
  .card {
    max-width: 720px;
    margin: 0 auto;
    background: var(--surface);
    border-radius: 14px;
    padding: 12px 14px 10px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.07), 0 6px 22px rgba(0, 0, 0, 0.05);
  }
  .context {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--ink);
  }
  .picker {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }
  .picker select {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    cursor: pointer;
  }
  .repo {
    font-weight: 500;
  }
  .branch {
    color: var(--muted-3);
  }
  textarea {
    width: 100%;
    margin: 8px 0 6px;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    font-size: 14.5px;
    line-height: 1.5;
    color: var(--ink);
  }
  textarea::placeholder {
    color: var(--muted-3);
  }
  .transcript {
    margin: 10px 0 12px;
    font-size: 14.5px;
    line-height: 1.5;
    color: var(--accent);
    min-height: 44px;
  }
  .attachment {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    font-size: 12.5px;
  }
  .attachment img {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border-radius: 8px;
  }
  .attachment button {
    color: var(--accent);
  }
  .note {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--red);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .attach {
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 8px;
    background: var(--press);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .attach:hover:not(:disabled) {
    background: var(--press-strong);
  }
  .attach:disabled {
    opacity: 0.5;
  }
  .mic,
  .send {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .mic:hover {
    background: rgba(0, 0, 0, 0.06);
  }
  .send {
    background: var(--muted-5);
    transition: background 0.15s ease;
  }
  .send.ready {
    background: var(--dark);
  }
  .record {
    display: flex;
    align-items: center;
    gap: 9px;
    background: var(--dark);
    border-radius: 999px;
    padding: 6px 12px 6px 9px;
    flex: none;
  }
  .record :global(.stop) {
    width: 14px;
    height: 14px;
  }
  .timer {
    font-size: 12.5px;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .wave {
    display: flex;
    align-items: center;
    gap: 2.5px;
    height: 14px;
  }
  .wave i {
    width: 2.5px;
    height: 14px;
    border-radius: 2px;
    background: #fff;
    animation: wave 0.9s ease-in-out infinite;
  }
  .wave i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .wave i:nth-child(3) {
    animation-delay: 0.3s;
  }
  .wave i:nth-child(4) {
    animation-delay: 0.45s;
  }
</style>
