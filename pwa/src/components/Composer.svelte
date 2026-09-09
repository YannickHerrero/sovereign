<script lang="ts">
  import { tick } from 'svelte';
  import { keyboard } from '../lib/keyboard.svelte';
  import { settings } from '../lib/settings.svelte';
  import type { Repo } from '../lib/types';
  import { VoiceSession, voiceAvailable } from '../lib/voice';
  import Icon from './Icon.svelte';

  interface Props {
    placeholder: string;
    /** Repo chip. When `repos` is given the chip becomes a picker for new tasks. */
    repo: string;
    branch?: string | null;
    model?: string | null;
    repos?: Repo[];
    onRepoChange?: (name: string) => void;
    onSubmit: (text: string) => Promise<void> | void;
    open?: boolean;
  }

  let { placeholder, repo, branch = null, model = null, repos, onRepoChange, onSubmit, open = $bindable(false) }: Props =
    $props();

  let draft = $state('');
  let sending = $state(false);
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let mode = $state<'text' | 'voice'>('text');
  let transcript = $state('');
  let voiceError = $state<string | null>(null);
  let seconds = $state(0);
  let voice: VoiceSession | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined;

  const hasDraft = $derived(draft.trim().length > 0);
  const timer = $derived(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
  const canVoice = $derived(voiceAvailable() && settings.openaiKey !== '');

  $effect(() => () => cancelVoice());

  async function start() {
    open = true;
    await tick();
    textarea?.focus();
  }

  function close() {
    cancelVoice();
    open = false;
  }

  async function startVoice() {
    if (!canVoice) {
      voiceError = voiceAvailable() ? 'Add an OpenAI key in Settings to dictate.' : 'Voice needs microphone access over HTTPS.';
      await start();
      return;
    }
    voiceError = null;
    transcript = '';
    seconds = 0;
    mode = 'voice';
    open = true;
    const session = new VoiceSession(settings.openaiKey, {
      onDelta: (text) => (transcript = text),
      onCompleted: (text) => (transcript = text),
      onError: (message) => (voiceError = message),
    });
    voice = session;
    try {
      await session.start();
      ticker = setInterval(() => seconds++, 1000);
    } catch (err) {
      voice = null;
      voiceError = (err as Error).message;
      mode = 'text';
      await tick();
      textarea?.focus();
    }
  }

  async function stopVoice() {
    const session = voice;
    voice = null;
    clearInterval(ticker);
    const text = session ? await session.stop() : transcript;
    draft = draft ? `${draft.trimEnd()} ${text}`.trim() : text;
    transcript = '';
    mode = 'text';
    await tick();
    textarea?.focus();
    textarea?.setSelectionRange(draft.length, draft.length);
  }

  function cancelVoice() {
    clearInterval(ticker);
    voice?.cancel();
    voice = null;
    transcript = '';
    mode = 'text';
  }

  async function submit() {
    const text = draft.trim();
    if (!text || sending) return;
    sending = true;
    try {
      await onSubmit(text);
      draft = '';
      open = false;
    } finally {
      sending = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  function mic() {
    void startVoice();
  }
</script>

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

      {#if mode === 'voice'}
        <div class="transcript">{transcript || (seconds === 0 ? 'Listening…' : '')}</div>
      {:else}
        <textarea
          bind:this={textarea}
          bind:value={draft}
          {placeholder}
          rows="3"
          onkeydown={onKeydown}
          enterkeyhint="send"
        ></textarea>
      {/if}
      {#if voiceError}
        <div class="voice-error">{voiceError}</div>
      {/if}

      <div class="bar">
        <div class="left">
          <span class="round round--filled small" aria-hidden="true">
            <Icon name="plus" color="var(--ink-control)" />
          </span>
          {#if model}
            <span class="model">
              <span>{model}</span>
              <Icon name="chevron" color="var(--muted-3)" />
            </span>
          {/if}
        </div>
        {#if mode === 'voice'}
          <button class="record" aria-label="Stop recording" onclick={stopVoice}>
            <Icon name="stop" />
            <span class="timer">{timer}</span>
            <span class="wave"><i></i><i></i><i></i><i></i><i></i></span>
          </button>
        {:else if hasDraft}
          <button class="round send" aria-label="Send" disabled={sending} onclick={submit}>
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
  .model {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13.5px;
    color: var(--ink-control);
    white-space: nowrap;
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
