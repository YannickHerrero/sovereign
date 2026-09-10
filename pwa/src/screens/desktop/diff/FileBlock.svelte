<script lang="ts">
  import Icon from '../../../components/Icon.svelte';
  import { contextLines, gapBefore, parsePatch, type DiffLine, type Hunk } from '../../../lib/diff/parse';
  import { highlighterFor, languageFor, plain, type LineHighlighter } from '../../../lib/diff/highlight';
  import { splitRows } from '../../../lib/diff/sideBySide';
  import type { DiffMode } from '../../../lib/diff/viewed.svelte';
  import type { FileDiff } from '../../../lib/types';

  interface Props {
    file: FileDiff;
    mode: DiffMode;
    viewed: boolean;
    onViewed: (viewed: boolean) => void;
    /** Loads the working-tree text once, for context expansion. */
    loadFile: () => Promise<string>;
  }

  let { file, mode, viewed, onViewed, loadFile }: Props = $props();

  const STEP = 20;
  /** Diffs above this many lines wait for a click, like GitHub's large-diff guard. */
  const LARGE = 1500;

  const parsed = $derived(parsePatch(file.patch));
  const lineCount = $derived(parsed.hunks.reduce((n, h) => n + h.lines.length, 0));
  let collapsed = $state(false);
  let forceLarge = $state(false);
  let hl = $state<LineHighlighter>(plain);

  $effect(() => {
    let cancelled = false;
    void highlighterFor(languageFor(file.path)).then((h) => {
      if (!cancelled && h) hl = h;
    });
    return () => {
      cancelled = true;
    };
  });
  let fileLines = $state<string[] | null>(null);
  let loadError = $state<string | null>(null);
  /** Context lines already revealed before each hunk index (index = hunks.length for the tail). */
  let revealed = $state<Record<number, { above: number; below: number }>>({});

  $effect(() => {
    collapsed = viewed;
  });

  async function ensureFile(): Promise<string[] | null> {
    if (fileLines) return fileLines;
    try {
      fileLines = (await loadFile()).split('\n');
      if (fileLines.at(-1) === '') fileLines.pop();
      return fileLines;
    } catch (err) {
      loadError = (err as Error).message;
      return null;
    }
  }

  /** Reveals context: `down` grows from the top of the gap, otherwise from its bottom. */
  async function expand(index: number, down: boolean, all = false) {
    if (!(await ensureFile())) return;
    const state = revealed[index] ?? { above: 0, below: 0 };
    const gap = gapBefore(parsed.hunks, index, fileLines!.length);
    if (!gap) return;
    const remaining = gap.toNew - gap.fromNew + 1 - state.above - state.below;
    const amount = all ? remaining : Math.min(STEP, remaining);
    revealed[index] = down ? { ...state, above: state.above + amount } : { ...state, below: state.below + amount };
  }

  interface Section {
    gapIndex: number;
    /** Lines revealed at the top of the gap, the hidden remainder, and lines revealed at the bottom. */
    top: DiffLine[];
    hidden: number;
    bottom: DiffLine[];
    hunk: Hunk | null;
  }

  const sections = $derived.by((): Section[] => {
    const total = fileLines?.length ?? null;
    const out: Section[] = [];
    for (let index = 0; index <= parsed.hunks.length; index++) {
      const gap = gapBefore(parsed.hunks, index, total);
      const state = revealed[index] ?? { above: 0, below: 0 };
      let top: DiffLine[] = [];
      let bottom: DiffLine[] = [];
      let hidden = gap ? gap.toNew - gap.fromNew + 1 : 0;
      if (gap && fileLines) {
        top = contextLines(fileLines, gap, gap.fromNew, gap.fromNew + state.above - 1);
        bottom = contextLines(fileLines, gap, gap.toNew - state.below + 1, gap.toNew);
        hidden = Math.max(0, hidden - top.length - bottom.length);
      } else if (!gap && !fileLines && index === parsed.hunks.length && parsed.hunks.length) {
        // Trailing context is unknown until the file is loaded; offer to expand anyway.
        hidden = -1;
      }
      out.push({ gapIndex: index, top, hidden, bottom, hunk: parsed.hunks[index] ?? null });
    }
    return out;
  });

  function copyPath() {
    void navigator.clipboard?.writeText(file.path);
  }
</script>

{#snippet unifiedLine(line: DiffLine)}
  <div class="u-line {line.kind}">
    <span class="no">{line.oldNo ?? ''}</span>
    <span class="no">{line.newNo ?? ''}</span>
    <span class="sign">{line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ''}</span>
    <span class="code">{@html hl.line(line.text) || ' '}</span>
  </div>
{/snippet}

{#snippet cell(line: DiffLine | null)}
  <span class="no">{line ? (line.kind === 'add' ? line.newNo : line.oldNo) : ''}</span>
  <span class="sign">{line?.kind === 'add' ? '+' : line?.kind === 'del' ? '-' : ''}</span>
  <span class="code">{@html line ? hl.line(line.text) || ' ' : ''}</span>
{/snippet}

{#snippet expander(section: Section)}
  {#if section.hidden !== 0 || section.top.length || section.bottom.length}
    {#each section.top as line (`t${line.newNo}`)}
      {#if mode === 'unified'}{@render unifiedLine(line)}{:else}
        <div class="s-row"><div class="s-cell context">{@render cell(line)}</div><div class="s-cell context">{@render cell(line)}</div></div>
      {/if}
    {/each}
    {#if section.hidden !== 0}
      <div class="gap">
        {#if section.gapIndex > 0}
          <button class="exp" title="Expand down" onclick={() => expand(section.gapIndex, true)}>↓</button>
        {/if}
        <button class="exp all" onclick={() => expand(section.gapIndex, true, true)}>
          {section.hidden > 0 ? `${section.hidden} hidden ${section.hidden === 1 ? 'line' : 'lines'}` : 'Expand'}
        </button>
        {#if section.hunk}
          <button class="exp" title="Expand up" onclick={() => expand(section.gapIndex, false)}>↑</button>
        {/if}
      </div>
    {/if}
    {#each section.bottom as line (`b${line.newNo}`)}
      {#if mode === 'unified'}{@render unifiedLine(line)}{:else}
        <div class="s-row"><div class="s-cell context">{@render cell(line)}</div><div class="s-cell context">{@render cell(line)}</div></div>
      {/if}
    {/each}
  {/if}
{/snippet}

<section class="block" id="file-{encodeURIComponent(file.path)}">
  <header class="head">
    <button class="fold" aria-expanded={!collapsed} onclick={() => (collapsed = !collapsed)}>
      <span class="caret" class:closed={collapsed}><Icon name="chevron" color="var(--muted-2)" /></span>
    </button>
    <span class="path" title={file.path}>{file.path}</span>
    <button class="icon" title="Copy path" aria-label="Copy path" onclick={copyPath}>⧉</button>
    <span class="grow"></span>
    <span class="stats"><span class="plus">+{file.plus}</span><span class="minus">-{file.minus}</span></span>
    <label class="viewed">
      <input type="checkbox" checked={viewed} onchange={(e) => onViewed(e.currentTarget.checked)} />
      Viewed
    </label>
  </header>

  {#if !collapsed}
    {#if parsed.binary}
      <div class="note">Binary file, no text diff.</div>
    {:else if !parsed.hunks.length}
      <div class="note">No textual changes.</div>
    {:else if lineCount > LARGE && !forceLarge}
      <div class="note large">
        <span>Large diff: {lineCount.toLocaleString()} lines are not rendered by default.</span>
        <button class="show" onclick={() => (forceLarge = true)}>Show diff</button>
      </div>
    {:else}
      <div class="body {mode}">
        {#each sections as section (section.gapIndex)}
          {@render expander(section)}
          {#if section.hunk}
            <div class="hunk-head">{section.hunk.header}</div>
            {#if mode === 'unified'}
              {#each section.hunk.lines as line, i (i)}
                {@render unifiedLine(line)}
              {/each}
            {:else}
              {#each splitRows(section.hunk.lines) as row, i (i)}
                <div class="s-row">
                  <div class="s-cell {row.left?.kind ?? 'empty'}">{@render cell(row.left)}</div>
                  <div class="s-cell {row.right?.kind ?? 'empty'}">{@render cell(row.right)}</div>
                </div>
              {/each}
            {/if}
          {/if}
        {/each}
      </div>
      {#if loadError}<div class="note error">Cannot expand context: {loadError}</div>{/if}
    {/if}
  {/if}
</section>

<style>
  .block {
    background: var(--surface);
    border-radius: 10px;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
    overflow: hidden;
  }
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    background: #f4f2ee;
    border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  }
  .fold {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
  }
  .fold:hover {
    background: var(--press);
  }
  .caret {
    display: flex;
    transition: transform 0.15s ease;
  }
  .caret.closed {
    transform: rotate(-90deg);
  }
  .path {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon {
    color: var(--muted-2);
    font-size: 13px;
    padding: 0 4px;
    border-radius: 5px;
  }
  .icon:hover {
    background: var(--press);
    color: var(--ink);
  }
  .grow {
    flex: 1;
  }
  .stats {
    display: flex;
    gap: 6px;
    font-size: 11.5px;
  }
  .viewed {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: var(--ink-control);
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--surface);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
    cursor: pointer;
  }
  .note {
    padding: 14px;
    font-size: 12.5px;
    color: var(--muted-2);
  }
  .note.error {
    color: var(--red);
  }
  .note.large {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .show {
    font-size: 12.5px;
    color: var(--accent);
    padding: 4px 10px;
    border-radius: 7px;
    background: rgba(44, 111, 187, 0.1);
  }
  .body {
    font-family: var(--mono);
    font-size: 11.5px;
    line-height: 1.6;
    overflow-x: auto;
  }
  .hunk-head {
    padding: 4px 12px 4px 92px;
    background: rgba(44, 111, 187, 0.07);
    color: #5b6f8f;
    border-top: 1px solid rgba(0, 0, 0, 0.04);
    border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  }
  .split .hunk-head {
    padding-left: 56px;
  }
  .u-line {
    display: grid;
    grid-template-columns: 44px 44px 16px 1fr;
    white-space: pre;
  }
  .no {
    padding: 0 6px;
    text-align: right;
    color: var(--muted-3);
    user-select: none;
    background: rgba(0, 0, 0, 0.02);
  }
  .sign {
    text-align: center;
    color: var(--muted-2);
    user-select: none;
  }
  .code {
    padding-right: 12px;
    color: var(--ink-body);
  }
  .u-line.add,
  .s-cell.add {
    background: rgba(46, 139, 87, 0.11);
  }
  .u-line.add .code,
  .s-cell.add .code {
    color: #1f6b41;
  }
  .u-line.del,
  .s-cell.del {
    background: rgba(196, 72, 60, 0.1);
  }
  .u-line.del .code,
  .s-cell.del .code {
    color: #a23a30;
  }
  .u-line.add .no,
  .s-cell.add .no {
    background: rgba(46, 139, 87, 0.16);
  }
  .u-line.del .no,
  .s-cell.del .no {
    background: rgba(196, 72, 60, 0.14);
  }
  .s-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .s-cell {
    display: grid;
    grid-template-columns: 44px 12px 1fr;
    white-space: pre;
    min-width: 0;
    overflow: hidden;
  }
  .s-cell + .s-cell {
    border-left: 1px solid rgba(0, 0, 0, 0.06);
  }
  .s-cell.empty {
    background: repeating-linear-gradient(45deg, transparent 0 6px, rgba(0, 0, 0, 0.025) 6px 8px);
  }
  .gap {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 12px 2px 8px;
    background: rgba(44, 111, 187, 0.05);
    border-top: 1px solid rgba(0, 0, 0, 0.04);
    border-bottom: 1px solid rgba(0, 0, 0, 0.04);
  }
  .exp {
    font-family: var(--font);
    font-size: 11px;
    color: var(--accent);
    padding: 1px 7px;
    border-radius: 5px;
  }
  .exp:hover {
    background: rgba(44, 111, 187, 0.1);
  }
  .exp.all {
    color: var(--muted-2);
  }
  /* Token colors, kept quiet to sit on the add/del tints. */
  .code :global(.hljs-keyword),
  .code :global(.hljs-selector-tag),
  .code :global(.hljs-built_in),
  .code :global(.hljs-type) {
    color: #7a5aa8;
  }
  .code :global(.hljs-string),
  .code :global(.hljs-attr),
  .code :global(.hljs-symbol),
  .code :global(.hljs-regexp) {
    color: #2e7d55;
  }
  .code :global(.hljs-number),
  .code :global(.hljs-literal) {
    color: #b0611f;
  }
  .code :global(.hljs-comment),
  .code :global(.hljs-quote) {
    color: var(--muted-2);
    font-style: italic;
  }
  .code :global(.hljs-title),
  .code :global(.hljs-name),
  .code :global(.hljs-section) {
    color: #2c6fbb;
  }
  .code :global(.hljs-variable),
  .code :global(.hljs-template-variable),
  .code :global(.hljs-property) {
    color: #8a4b6b;
  }
  .code :global(.hljs-meta),
  .code :global(.hljs-tag) {
    color: #5b6f8f;
  }
</style>
