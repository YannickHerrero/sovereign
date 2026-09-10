<script lang="ts">
  import { renderMarkdown } from '../lib/markdown';

  let { text, variant = 'mobile' }: { text: string; variant?: 'mobile' | 'desktop' } = $props();
  const html = $derived(renderMarkdown(text));
</script>

<div class="markdown {variant}">{@html html}</div>

<style>
  .markdown {
    min-width: 0;
    color: var(--ink-body);
    font-size: 14.5px;
    line-height: 1.5;
    overflow-wrap: anywhere;
    --block-gap: 11px;
  }
  .desktop {
    font-size: 14px;
    line-height: 1.55;
    --block-gap: 10px;
  }
  .markdown :global(p),
  .markdown :global(ul),
  .markdown :global(ol),
  .markdown :global(blockquote),
  .markdown :global(pre),
  .markdown :global(.table-scroll) {
    margin: 0 0 var(--block-gap);
  }
  .markdown :global(h1),
  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4),
  .markdown :global(h5),
  .markdown :global(h6) {
    color: var(--ink-strong);
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.2px;
    margin: 1em 0 6px;
  }
  .markdown :global(h1) { font-size: 1.4em; }
  .markdown :global(h2) { font-size: 1.25em; }
  .markdown :global(h3) { font-size: 1.15em; }
  .markdown :global(h4) { font-size: 1.08em; }
  .markdown :global(h5) { font-size: 1em; }
  .markdown :global(h6) { font-size: 0.95em; }
  .markdown :global(> :first-child) { margin-top: 0; }
  .markdown :global(ul),
  .markdown :global(ol) { padding-left: 24px; }
  .markdown :global(li > ul),
  .markdown :global(li > ol) { margin-bottom: 0; }
  .markdown :global(li + li) { margin-top: 3px; }
  .markdown :global(input[type='checkbox']) {
    margin: 0 5px 0 0;
    vertical-align: middle;
  }
  .markdown :global(blockquote) {
    border-left: 3px solid var(--press-strong);
    padding: 2px 0 2px 12px;
    color: var(--ink-mono);
  }
  .markdown :global(blockquote > :last-child) { margin-bottom: 0; }
  .markdown :global(hr) {
    border: 0;
    border-top: 1px solid var(--press-strong);
    margin: 16px 0;
  }
  .markdown :global(a[href]) { text-decoration: underline; }
  .markdown :global(code) {
    font-family: var(--mono);
    font-size: 0.86em;
    background: var(--press);
    padding: 1px 5px;
    border-radius: 5px;
  }
  .markdown :global(pre) {
    max-width: 100%;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--press);
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.5;
    white-space: pre;
    overflow-wrap: normal;
    overflow-x: auto;
  }
  .markdown :global(pre code) {
    font-size: inherit;
    background: none;
    padding: 0;
    border-radius: 0;
  }
  .markdown :global(.table-scroll) {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--press-strong);
    border-radius: 8px;
  }
  .markdown :global(.table-scroll:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .markdown :global(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: inherit;
    overflow-wrap: normal;
  }
  .markdown :global(th),
  .markdown :global(td) {
    padding: 8px 10px;
    vertical-align: top;
    border: 1px solid var(--press-strong);
  }
  .markdown :global(th) {
    background: var(--press);
    font-weight: 600;
  }
  .markdown :global(th:not([align])),
  .markdown :global(td:not([align])) { text-align: left; }
  .markdown :global(td code),
  .markdown :global(th code) { white-space: nowrap; }
</style>
