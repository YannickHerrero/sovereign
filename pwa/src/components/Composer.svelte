<script lang="ts">
  import { tick } from 'svelte';
  import { ComposerState, isSubmitShortcut, type SubmitHandler } from '../lib/composer.svelte';
  import { shouldCapture, shouldCapturePaste } from '../lib/typeahead';
  import { keyboard } from '../lib/keyboard.svelte';
  import type { AgentKind, ModelList, PiModel, Repo } from '../lib/types';
  import ModelPicker from './ModelPicker.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    placeholder: string;
    /** Repo chip. When `repos` is given the chip becomes a picker for new tasks. */
    repo: string;
    branch?: string | null;
    model?: string | null;
    agent?: AgentKind | null;
    loadModels: () => Promise<ModelList>;
    onModelChange: (model: PiModel) => Promise<void> | void;
    modelDisabled?: boolean;
    repos?: Repo[];
    onRepoChange?: (name: string) => void;
    onSubmit: SubmitHandler;
    /** Route keystrokes and pastes made outside any field into this composer. */
    captureTyping?: boolean;
    /** Page-level overlays (menu, diff) that must keep stray keystrokes for themselves. */
    typingBlocked?: () => boolean;
    open?: boolean;
  }

  let {
    placeholder, repo, branch = null, model = null, agent = null, loadModels, onModelChange, modelDisabled = false,
    repos, onRepoChange, onSubmit, open = $bindable(false), captureTyping = false, typingBlocked = () => false,
  }: Props = $props();

  const c = new ComposerState();
  let modelBusy = $state(false);
  let imageInput: HTMLInputElement;
  let textarea = $state<HTMLTextAreaElement | null>(null);

  $effect(() => () => c.dispose());

  // Hardware keyboards only (iPad in landscape): opens the sheet and types into it.
  $effect(() => {
    if (!captureTyping) return;
    const onKey = (event: KeyboardEvent) => {
      if (c.mode === 'voice' || c.sending) return;
      const char = shouldCapture(event, typingBlocked);
      if (char === null) return;
      event.preventDefault();
      open = true;
      c.append(char);
      void focusEnd();
    };
    const onStrayPaste = (event: ClipboardEvent) => {
      if (c.mode === 'voice' || c.sending || !shouldCapturePaste(event, typingBlocked)) return;
      event.preventDefault();
      open = true;
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

  async function start() {
    open = true;
    await tick();
    textarea?.focus();
  }

  function close() {
    if (modelBusy) return;
    c.cancelVoice();
    open = false;
  }

  async function mic() {
    open = true;
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
    textarea?.blur();
    open = false;
    const sent = await c.submit(onSubmit);
    if (!sent) open = true;
  }

  function onKeydown(event: KeyboardEvent) {
    if (isSubmitShortcut(event)) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<input hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" bind:this={imageInput} onchange={chooseImage} />

{#if !open}
  <div class="idle" style:bottom="calc(var(--safe-bottom) + 14px + {keyboard.height}px)">
    <div class="pill">
      <button class="round round--filled" aria-label="New" onclick={start}>
        <Icon name="plus" color="var(--ink-control)" />
      </button>
      <button class="ghost" onclick={start}>{placeholder}</button>
      <button class="round" aria-label="Voice" onclick={mic}>
        <Icon name="mic" color="var(--ink-control)" />
      </button>
    </div>
  </div>
{:else}
  <div class="overlay">
    <button class="backdrop" aria-label="Close" onclick={close}></button>
    <div class="sheet" style:bottom="calc(var(--safe-bottom) + 12px + {keyboard.height}px)">
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
        {/if}
      </div>

      {#if c.mode === 'voice'}
        <div class="transcript">{c.transcript || (c.seconds === 0 ? 'Listening…' : '')}</div>
      {:else}
        <textarea
          bind:this={textarea}
          bind:value={c.draft}
          disabled={c.sending}
          {placeholder}
          rows="3"
          onkeydown={onKeydown}
          onpaste={onPaste}
          enterkeyhint="send"
        ></textarea>
      {/if}
      {#if c.image}
        <div class="attachment">
          <img src={`data:${c.image.mimeType};base64,${c.image.data}`} alt="Attachment preview" />
          <button disabled={c.sending} onclick={() => c.removeImage()} aria-label="Remove image">Remove image</button>
        </div>
      {/if}
      {#if c.imageLoading}<div class="voice-error">Loading image…</div>{/if}
      {#if c.imageError}<div class="voice-error" role="alert">{c.imageError}</div>{/if}
      {#if c.voiceError}
        <div class="voice-error">{c.voiceError}</div>
      {/if}

      <div class="bar">
        <div class="left">
          <button class="round round--filled small" aria-label="Attach image" title="Attach image"
            disabled={c.busy || c.mode === 'voice'} onclick={() => imageInput.click()}>
            <Icon name="plus" color="var(--ink-control)" />
          </button>
          <ModelPicker {model} {agent} {loadModels} {onModelChange} disabled={modelDisabled || c.busy || c.mode === 'voice'} bind:busy={modelBusy} />
        </div>
        {#if c.mode === 'voice'}
          <button class="record" aria-label="Stop recording" onclick={stopVoice}>
            <Icon name="stop" />
            <span class="timer">{c.timer}</span>
            <span class="wave"><i></i><i></i><i></i><i></i><i></i></span>
          </button>
        {:else if c.hasDraft}
          <button class="round send" aria-label="Send" disabled={c.busy || modelBusy} onclick={submit}>
            <Icon name="send" color="#fff" />
          </button>
        {:else}
          <button class="round round--filled" aria-label="Voice" onclick={mic}>
            <Icon name="mic" color="var(--ink-control)" />
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .attachment {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
    font-size: 13px;
  }
  .attachment img {
    width: 72px;
    height: 72px;
    object-fit: cover;
    border-radius: 10px;
  }
  .idle {
    position: absolute;
    left: 14px;
    right: 14px;
    z-index: 30;
    transition: bottom 0.15s ease;
  }
  .pill {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--surface);
    border-radius: 999px;
    padding: 8px 10px;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.08), 0 0 0 1px var(--hairline);
  }
  .ghost {
    flex: 1;
    text-align: left;
    font-size: 15px;
    color: var(--muted-3);
    padding: 2px 0;
    cursor: text;
  }
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 40;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(30, 28, 24, 0.16);
    cursor: default;
  }
  .sheet {
    position: absolute;
    left: 12px;
    right: 12px;
    background: var(--surface);
    border-radius: 22px;
    padding: 14px 14px 10px;
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.16);
    animation: sheetUp 0.24s cubic-bezier(0.22, 0.8, 0.3, 1) both;
    transition: bottom 0.15s ease;
  }
  .context {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    color: var(--ink);
  }
  .picker {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .picker select {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    font-size: 16px;
  }
  .repo {
    font-weight: 500;
  }
  .branch {
    color: var(--muted-3);
  }
  textarea {
    width: 100%;
    margin: 9px 0 8px;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    font-size: 15.5px;
    line-height: 1.45;
    color: var(--ink);
  }
  textarea::placeholder {
    color: var(--muted-3);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .left {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
  }
  .small {
    width: 32px;
    height: 32px;
  }
  .send {
    background: var(--dark);
  }
  .send:disabled {
    opacity: 0.6;
  }
  .transcript {
    margin: 11px 0 14px;
    font-size: 15.5px;
    line-height: 1.45;
    color: var(--accent);
    min-height: 66px;
  }
  .voice-error {
    margin: 0 0 8px;
    font-size: 12.5px;
    color: var(--red);
  }
  .record {
    display: flex;
    align-items: center;
    gap: 9px;
    background: var(--dark);
    border-radius: 999px;
    padding: 7px 12px 7px 9px;
    flex: none;
  }
  .timer {
    font-size: 13px;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
  .wave {
    display: flex;
    align-items: center;
    gap: 2.5px;
    height: 15px;
  }
  .wave i {
    width: 2.5px;
    height: 15px;
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
  .wave i:nth-child(5) {
    animation-delay: 0.6s;
  }
</style>
