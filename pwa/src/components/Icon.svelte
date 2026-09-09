<script lang="ts">
  type Name = 'back' | 'forward' | 'search' | 'filter' | 'dots' | 'plus' | 'mic' | 'send' | 'chevron' | 'pr' | 'gear' | 'close' | 'stop';

  let { name, color = 'currentColor' }: { name: Name; color?: string } = $props();
</script>

{#if name === 'back'}
  <svg width="9" height="15" viewBox="0 0 9 15"><path d="M7.5 1L1.5 7.5l6 6.5" fill="none" stroke={color} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
{:else if name === 'forward'}
  <svg width="8" height="13" viewBox="0 0 9 15"><path d="M1.5 1l6 6.5-6 6.5" fill="none" stroke={color} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
{:else if name === 'search'}
  <svg width="17" height="17" viewBox="0 0 18 18"><circle cx="7.6" cy="7.6" r="5.6" fill="none" stroke={color} stroke-width="1.6" /><path d="M11.8 11.8L16 16" stroke={color} stroke-width="1.6" stroke-linecap="round" /></svg>
{:else if name === 'filter'}
  <svg width="18" height="14" viewBox="0 0 18 14"><path d="M1 2h16M3.5 7h11M6.5 12h5" stroke={color} stroke-width="1.6" stroke-linecap="round" /></svg>
{:else if name === 'dots'}
  <span class="dots" style:--c={color}><i></i><i></i><i></i></span>
{:else if name === 'plus'}
  <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1.5v11M1.5 7h11" stroke={color} stroke-width="1.7" stroke-linecap="round" /></svg>
{:else if name === 'mic'}
  <svg width="15" height="19" viewBox="0 0 15 19"><rect x="4.6" y="1" width="6" height="10" rx="3" fill="none" stroke={color} stroke-width="1.6" /><path d="M1.6 9.2a5.9 5.9 0 0011.8 0M7.5 15v3" fill="none" stroke={color} stroke-width="1.6" stroke-linecap="round" /></svg>
{:else if name === 'send'}
  <svg width="14" height="15" viewBox="0 0 14 15"><path d="M7 13.5V1.8M2 6.6L7 1.5l5 5.1" fill="none" stroke={color} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
{:else if name === 'chevron'}
  <svg width="9" height="6" viewBox="0 0 9 6"><path d="M1 1l3.5 3.5L8 1" fill="none" stroke={color} stroke-width="1.4" stroke-linecap="round" /></svg>
{:else if name === 'pr'}
  <svg width="13" height="13" viewBox="0 0 14 14"><circle cx="3.2" cy="3.2" r="2.2" fill="none" stroke={color} stroke-width="1.4" /><circle cx="3.2" cy="11" r="2.2" fill="none" stroke={color} stroke-width="1.4" /><circle cx="10.8" cy="11" r="2.2" fill="none" stroke={color} stroke-width="1.4" /><path d="M3.2 5.4v3.4M5.4 3.2h3.2a2.2 2.2 0 012.2 2.2v3.4" fill="none" stroke={color} stroke-width="1.4" /></svg>
{:else if name === 'gear'}
  <svg width="17" height="17" viewBox="0 0 18 18"><circle cx="9" cy="9" r="2.6" fill="none" stroke={color} stroke-width="1.5" /><path d="M9 1.6v2.1M9 14.3v2.1M1.6 9h2.1M14.3 9h2.1M3.8 3.8l1.5 1.5M12.7 12.7l1.5 1.5M3.8 14.2l1.5-1.5M12.7 5.3l1.5-1.5" stroke={color} stroke-width="1.5" stroke-linecap="round" /></svg>
{:else if name === 'close'}
  <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke={color} stroke-width="1.6" stroke-linecap="round" /></svg>
{:else if name === 'stop'}
  <span class="stop"></span>
{/if}

<style>
  svg {
    display: block;
  }
  .dots {
    display: flex;
    gap: 2.5px;
  }
  .dots i {
    width: 3.4px;
    height: 3.4px;
    border-radius: 999px;
    background: var(--c);
  }
  .stop {
    width: 15px;
    height: 15px;
    border-radius: 4px;
    background: #fff;
    display: block;
  }
</style>
