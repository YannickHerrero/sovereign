<script lang="ts">
  import type { AgentRequest, Answers, Question } from '../lib/requests';

  let { request, onAnswer }: { request: AgentRequest; onAnswer: (answers: Answers | null) => Promise<void> | void } = $props();

  let picked = $state<Record<string, string[]>>({});
  let other = $state<Record<string, string>>({});
  // The parent keys cards by request id, so seeding from the initial request is intended.
  // svelte-ignore state_referenced_locally
  let text = $state<Record<string, string>>(Object.fromEntries(request.questions.map((q) => [q.key, q.prefill ?? ''])));
  let confirmed = $state<Record<string, boolean | undefined>>({});
  let sending = $state(false);

  const single = $derived(request.questions.length === 1);

  function answered(q: Question): boolean {
    switch (q.kind) {
      case 'select':
        return (picked[q.key]?.length ?? 0) > 0 || (other[q.key]?.trim().length ?? 0) > 0;
      case 'confirm':
        return confirmed[q.key] !== undefined;
      default:
        return (text[q.key]?.trim().length ?? 0) > 0;
    }
  }

  const complete = $derived(request.questions.every(answered));

  function toggle(q: Question, label: string) {
    const current = picked[q.key] ?? [];
    if (q.multi) {
      picked[q.key] = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    } else {
      picked[q.key] = current[0] === label ? [] : [label];
      other[q.key] = '';
    }
    // A single-choice question with one answer needs no further click.
    if (single && !q.multi && picked[q.key].length) void submit();
  }

  function decide(q: Question, value: boolean) {
    confirmed[q.key] = value;
    if (single) void submit();
  }

  async function submit() {
    if (!complete || sending) return;
    sending = true;
    try {
      const answers: Answers = {};
      for (const q of request.questions) {
        if (q.kind === 'select') {
          const free = other[q.key]?.trim();
          const labels = [...(picked[q.key] ?? [])];
          if (free) labels.push(free);
          answers[q.key] = q.multi ? labels : labels[0] ?? '';
        } else if (q.kind === 'confirm') {
          answers[q.key] = confirmed[q.key] === true;
        } else {
          answers[q.key] = text[q.key] ?? '';
        }
      }
      await onAnswer(answers);
    } finally {
      sending = false;
    }
  }

  async function dismiss() {
    if (sending) return;
    sending = true;
    try {
      await onAnswer(null);
    } finally {
      sending = false;
    }
  }
</script>

<div class="card" role="group" aria-label="The agent has a question">
  {#each request.questions as q (q.key)}
    <div class="question">
      <div class="head">
        <span class="chip">{q.title}</span>
        {#if q.message}<span class="message">{q.message}</span>{/if}
      </div>

      {#if q.kind === 'select'}
        <div class="options">
          {#each q.options ?? [] as option (option.label)}
            <button class="option" class:on={picked[q.key]?.includes(option.label)} disabled={sending} onclick={() => toggle(q, option.label)}>
              <span class="label">{option.label}</span>
              {#if option.description}<span class="desc">{option.description}</span>{/if}
            </button>
          {/each}
          <input class="field other" placeholder="Other…" bind:value={other[q.key]} disabled={sending} />
        </div>
      {:else if q.kind === 'confirm'}
        <div class="row">
          <button class="btn" class:on={confirmed[q.key] === false} disabled={sending} onclick={() => decide(q, false)}>No</button>
          <button class="btn btn--dark" class:on={confirmed[q.key] === true} disabled={sending} onclick={() => decide(q, true)}>Yes</button>
        </div>
      {:else if q.kind === 'input'}
        <input class="field" placeholder={q.placeholder ?? 'Your answer'} bind:value={text[q.key]} disabled={sending}
          onkeydown={(e) => e.key === 'Enter' && void submit()} />
      {:else}
        <textarea class="field" rows="4" bind:value={text[q.key]} disabled={sending}></textarea>
      {/if}
    </div>
  {/each}

  <div class="actions">
    <button class="link" disabled={sending} onclick={dismiss}>Dismiss</button>
    {#if !(single && request.questions[0].kind === 'confirm')}
      <button class="btn btn--dark" disabled={!complete || sending} onclick={submit}>{sending ? 'Sending…' : 'Answer'}</button>
    {/if}
  </div>
</div>

<style>
  .card {
    background: var(--surface);
    border-radius: 14px;
    padding: 14px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.07), 0 6px 22px rgba(0, 0, 0, 0.05);
    display: flex;
    flex-direction: column;
    gap: 14px;
    animation: fadeUp 0.22s ease both;
  }
  .question {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chip {
    align-self: flex-start;
    font-size: 11px;
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--accent);
    background: rgba(44, 111, 187, 0.1);
    border-radius: 999px;
    padding: 2px 8px;
  }
  .message {
    font-size: 14px;
    line-height: 1.45;
    color: var(--ink);
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .option {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: 9px 12px;
    border-radius: 10px;
    background: var(--press);
    transition: background 0.12s ease;
  }
  .option:hover {
    background: var(--press-strong);
  }
  .option.on {
    background: var(--dark);
    color: #fff;
  }
  .label {
    font-size: 13.5px;
  }
  .desc {
    font-size: 12px;
    color: var(--muted-2);
  }
  .option.on .desc {
    color: rgba(255, 255, 255, 0.7);
  }
  .other {
    margin-top: 2px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 12px;
  }
  .btn {
    padding: 8px 16px;
    border-radius: 999px;
    background: var(--press);
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink-control);
  }
  .btn.on {
    box-shadow: 0 0 0 2px var(--accent);
  }
  .btn:disabled {
    opacity: 0.45;
  }
  .btn--dark {
    background: var(--dark);
    color: #fff;
  }
  .link {
    font-size: 13px;
    color: var(--muted-2);
  }
  textarea.field {
    resize: vertical;
    line-height: 1.45;
  }
</style>
