<script lang="ts">
  import { tick } from 'svelte';
  import type { ChatSession } from '../lib/chat.svelte';
  import { blocks } from '../lib/markdown';
  import RequestCard from './RequestCard.svelte';

  /** `variant` only changes spacing and type sizes; the structure is shared. */
  let { session, variant = 'mobile' }: { session: ChatSession; variant?: 'mobile' | 'desktop' } = $props();

  let expandedFiles = $state<Record<number, boolean>>({});
  let scroller = $state<HTMLDivElement | null>(null);

  $effect(() =>
    session.onAppend(() => {
      void scrollToEnd();
    }),
  );

  async function scrollToEnd() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }
</script>

<div class="scroll thread {variant}" bind:this={scroller}>
  <div class="inner">
    {#each session.turns as turn, index (index)}
      {#if turn.role === 'user'}
        <div class="user">
          {#each turn.images ?? [] as image}
            <img class="message-image" src={`data:${image.mimeType};base64,${image.data}`} alt="Attachment" />
          {/each}
          {turn.text}
        </div>
      {:else}
        <div class="agent">
          <div class="meta">{session.metaLabel(turn)}</div>
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
              {#each expandedFiles[index] ? turn.files : turn.files.slice(0, 3) as path (path)}
                {@const stats = index === session.lastAgentIndex ? session.statsFor(path) : undefined}
                <div class="file">
                  <span class="path">{path}</span>
                  {#if stats}
                    <span class="stats"><span class="plus">+{stats.plus}</span><span class="minus">-{stats.minus}</span></span>
                  {/if}
                </div>
              {/each}
              {#if turn.files.length > 3}
                <button class="show-files" aria-expanded={!!expandedFiles[index]}
                  onclick={() => (expandedFiles[index] = !expandedFiles[index])}>
                  {expandedFiles[index] ? 'Show less' : `Show more (${turn.files.length - 3})`}
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    {/each}

    {#if session.live}
      <div class="agent">
        {#if session.live.text}
          {#each blocks(session.live.text) as block}
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
          <span class="shimmer">{session.live.status}</span>
        </div>
      </div>
    {/if}

    {#each session.requests as request (request.id)}
      <RequestCard {request} onAnswer={(answers) => session.answer(request, answers)} />
    {/each}

    {#if session.notice}
      <div class="notice">{session.notice}</div>
    {/if}
    {#if session.error}
      <div class="error">{session.error}</div>
    {/if}
  </div>
</div>

<style>
  .thread.mobile {
    padding: 14px 20px calc(var(--safe-bottom) + 130px);
  }
  .thread.desktop {
    padding: 26px 0;
  }
  .inner {
    display: flex;
    flex-direction: column;
    gap: 22px;
  }
  .desktop .inner {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 28px;
    gap: 24px;
  }
  .message-image {
    display: block;
    max-width: 100%;
    max-height: 300px;
    object-fit: contain;
    border-radius: 10px;
    margin-bottom: 8px;
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
  .desktop .user {
    max-width: 74%;
    border-radius: 16px;
    font-size: 14px;
    animation-duration: 0.2s;
  }
  .agent {
    animation: fadeUp 0.24s ease both;
  }
  .meta {
    font-size: 12.5px;
    color: #a19e96;
    margin-bottom: 5px;
  }
  .desktop .meta {
    font-size: 12px;
  }
  .heading {
    font-size: 15.5px;
    font-weight: 600;
    color: var(--ink-strong);
    letter-spacing: -0.2px;
    margin-bottom: 6px;
  }
  .desktop .heading {
    font-size: 15px;
  }
  .agent p,
  .agent ul {
    margin: 0 0 11px;
    font-size: 14.5px;
    line-height: 1.5;
    color: var(--ink-body);
  }
  .desktop .agent p,
  .desktop .agent ul {
    margin-bottom: 10px;
    font-size: 14px;
    line-height: 1.55;
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
  .desktop .files {
    margin-top: 12px;
    gap: 0;
    border-radius: 10px;
    background: var(--surface);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.07);
  }
  .file {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 9px 12px;
    background: var(--bg);
  }
  .desktop .file {
    gap: 12px;
    padding: 9px 13px;
    background: var(--surface);
    border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  }
  .show-files {
    padding: 9px 12px;
    background: var(--bg);
    color: var(--accent);
    font-size: 12px;
    text-align: left;
  }
  .desktop .show-files {
    background: var(--surface);
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
  .desktop .shimmer {
    font-size: 13.5px;
  }
  .notice {
    font-size: 12.5px;
    color: var(--muted-2);
  }
  .error {
    font-size: 12.5px;
    color: var(--red);
  }
</style>
