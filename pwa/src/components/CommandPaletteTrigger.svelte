<script lang="ts">
  let { onSearch }: { onSearch: () => void } = $props();
  const shortcut = navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K';
</script>

<button class="palette-trigger" aria-label="Search discussions and machines" title="Search (Ctrl+K / ⌘K)" onclick={onSearch}>
  <svg width="13" height="13" viewBox="0 0 18 18" aria-hidden="true">
    <circle cx="7.6" cy="7.6" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6" />
    <path d="M11.8 11.8L16 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
  </svg>
  <kbd>{shortcut}</kbd>
</button>

<style>
  .palette-trigger { display: flex; align-items: center; gap: 7px; flex: none; padding: 4px 9px; border-radius: 8px; font-size: 12px; color: var(--muted); box-shadow: 0 0 0 1px rgba(0, 0, 0, .07); }
  .palette-trigger:hover { background: rgba(0, 0, 0, .04); }
  .palette-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  svg { flex: none; color: var(--muted-3); }
  kbd { font-family: var(--mono); font-size: 11px; white-space: nowrap; }
</style>
