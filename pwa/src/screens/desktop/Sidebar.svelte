<script lang="ts">
  import Icon from '../../components/Icon.svelte';
  import { seenLabel } from '../../lib/format';
  import { presence } from '../../lib/presence.svelte';
  import { router } from '../../lib/router.svelte';
  import { settings } from '../../lib/settings.svelte';
  import { FILTERS, matches, type Filter } from '../../lib/tasks';
  import type { WorkspaceStore } from '../../lib/workspace.svelte';

  interface Props {
    store: WorkspaceStore | undefined;
    filter: Filter;
    onFilter: (filter: Filter) => void;
    model: string | null;
  }

  let { store, filter, onFilter, model }: Props = $props();

  const route = $derived(router.route);
  const activeWs = $derived('wsId' in route ? route.wsId : undefined);

  $effect(() => presence.acquire());

  function count(f: Filter): number {
    return store ? store.tasks.filter((t) => matches(t, '', f)).length : 0;
  }
</script>

<aside class="sidebar">
  <div class="titlebar"></div>

  <div class="section">Workspaces</div>
  <div class="items">
    {#each settings.servers as server (server.id)}
      {@const status = presence.status(server.id)}
      {@const online = status?.online ?? false}
      {@const agents = status?.agents ?? 0}
      <button class="ws" class:active={server.id === activeWs} onclick={() => router.go({ name: 'tasks', wsId: server.id })}>
        <div class="row">
          <span class="dot" style:width="7px" style:height="7px" style:background={online ? 'var(--green)' : 'var(--muted-5)'}></span>
          <span class="name">{server.name}</span>
          {#if agents > 0}
            <span class="badge">{agents}</span>
          {/if}
        </div>
        <div class="sub">{status === undefined ? 'Connecting' : online ? 'Online' : 'Offline'} · {seenLabel(online, server.lastSeen, presence.now)}</div>
      </button>
    {:else}
      <div class="hint">No machine yet.</div>
    {/each}
  </div>

  <div class="section filters-title">Filters</div>
  <div class="items">
    {#each FILTERS as f (f ?? 'all')}
      <button class="filter" class:active={f === filter && route.name !== 'settings'} onclick={() => onFilter(f)}>
        <span>{f ?? 'All tasks'}</span>
        <span class="count">{count(f)}</span>
      </button>
    {/each}
  </div>

  <div class="spacer"></div>

  <button class="footer" class:active={route.name === 'settings'} onclick={() => router.go({ name: 'settings' })}>
    <span class="gear"><Icon name="gear" color="var(--ink-control)" /></span>
    <span class="footer-text">
      <span class="footer-title">Settings</span>
      <span class="footer-sub">{model ?? 'Machines and voice'}</span>
    </span>
  </button>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    background: #f1efea;
    border-right: 1px solid rgba(0, 0, 0, 0.07);
    min-height: 0;
    overflow-y: auto;
  }
  .titlebar {
    height: 44px;
    flex: none;
  }
  .section {
    padding: 10px 16px 8px;
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #a09d94;
  }
  .filters-title {
    margin-top: 20px;
  }
  .items {
    padding: 0 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ws,
  .filter {
    width: 100%;
    text-align: left;
    border-radius: 9px;
    transition: background 0.12s ease;
  }
  .ws {
    padding: 9px 10px;
  }
  .ws:hover,
  .filter:hover {
    background: rgba(0, 0, 0, 0.045);
  }
  .ws.active {
    background: rgba(0, 0, 0, 0.07);
  }
  .filter.active {
    background: rgba(0, 0, 0, 0.06);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex: none;
    font-size: 11px;
    color: var(--accent);
    background: rgba(44, 111, 187, 0.1);
    border-radius: 999px;
    padding: 1px 6px;
    white-space: nowrap;
  }
  .sub {
    margin-top: 3px;
    padding-left: 15px;
    font-size: 11.5px;
    color: var(--muted-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .filter {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    font-size: 13px;
    color: var(--ink-control);
  }
  .count {
    font-size: 11.5px;
    color: var(--muted-3);
  }
  .hint {
    padding: 6px 10px;
    font-size: 12px;
    color: var(--muted-3);
  }
  .spacer {
    flex: 1;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 14px 16px;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    text-align: left;
    flex: none;
  }
  .footer:hover,
  .footer.active {
    background: rgba(0, 0, 0, 0.035);
  }
  .gear {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    background: #cfc9bc;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  }
  .footer-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .footer-title {
    font-size: 12.5px;
    color: var(--ink);
    white-space: nowrap;
  }
  .footer-sub {
    font-size: 11px;
    color: var(--muted-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
