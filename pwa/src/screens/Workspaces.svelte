<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { agentsLabel, seenLabel } from '../lib/format';
  import { presence } from '../lib/presence.svelte';
  import { router } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';

  $effect(() => presence.acquire());
</script>

<div class="screen">
  <div class="header">
    <div>
      <img class="logo" src="/logo.png" alt="Sovereign" width="28" height="28" />
      <div class="title">Workspaces</div>
      <div class="subtitle">Choose a machine to work on</div>
    </div>
    <button class="round" aria-label="Settings" onclick={() => router.go({ name: 'settings' })}>
      <Icon name="gear" color="var(--ink-icon)" />
    </button>
  </div>

  <div class="scroll list">
    {#each settings.servers as server (server.id)}
      {@const status = presence.status(server.id)}
      {@const online = status?.online ?? false}
      {@const agents = status?.agents ?? 0}
      <button class="card ws" onclick={() => router.go({ name: 'tasks', wsId: server.id })}>
        <div class="row">
          <span class="dot ws-dot" style:background={online ? 'var(--green)' : 'var(--muted-5)'}></span>
          <span class="name">{server.name}</span>
          <Icon name="forward" color="var(--chevron)" />
        </div>
        <div class="meta">
          <span style:color={online ? 'var(--green)' : 'var(--muted-3)'}>{status === undefined ? 'Connecting' : online ? 'Online' : 'Offline'}</span>
          <span class="sep">·</span>
          <span>{seenLabel(online, server.lastSeen, presence.now)}</span>
        </div>
        <div class="agents">
          {#if agents > 0}
            <span class="dot dot--pulse" style:width="6px" style:height="6px"></span>
            <span class="busy">{agentsLabel(agents)}</span>
          {:else}
            <span class="quiet">{agentsLabel(0)}</span>
          {/if}
        </div>
      </button>
    {:else}
      <div class="empty">
        <p>No workspace yet.</p>
        <button class="link" onclick={() => router.go({ name: 'settings' })}>Add a machine in Settings</button>
      </div>
    {/each}
  </div>
</div>

<style>
  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: calc(var(--safe-top) + 22px) 16px 4px 22px;
  }
  .logo {
    display: block;
    width: 28px;
    height: 28px;
    margin-bottom: 10px;
  }
  .list {
    padding: 16px 14px calc(var(--safe-bottom) + 40px);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ws {
    padding: 14px 15px;
    text-align: left;
    width: 100%;
    transition: background 0.12s ease;
  }
  .ws:active {
    background: #fbfaf8;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .ws-dot {
    width: 7px;
    height: 7px;
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 15.5px;
    font-weight: 500;
    letter-spacing: -0.2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    margin-top: 6px;
    padding-left: 16px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted-2);
    white-space: nowrap;
  }
  .agents {
    margin-top: 9px;
    padding-left: 16px;
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .busy {
    color: var(--accent);
  }
  .quiet {
    color: var(--muted-4);
  }
  .empty {
    padding: 40px 22px;
    text-align: center;
    font-size: 13.5px;
    color: var(--muted-3);
  }
  .empty p {
    margin: 0 0 8px;
  }
  .link {
    color: var(--accent);
  }
</style>
