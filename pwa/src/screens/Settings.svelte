<script lang="ts">
  import Icon from '../components/Icon.svelte';
  import { api } from '../lib/api';
  import { router } from '../lib/router.svelte';
  import { settings } from '../lib/settings.svelte';

  /** Rendered inside the desktop shell: no back button, content centered. */
  let { embedded = false }: { embedded?: boolean } = $props();

  let name = $state('');
  let url = $state('');
  let token = $state('');
  let testing = $state(false);
  let testResult = $state<string | null>(null);
  let openaiKey = $state(settings.openaiKey);

  const canAdd = $derived(name.trim() !== '' && url.trim() !== '' && token.trim() !== '');

  async function test() {
    testing = true;
    testResult = null;
    try {
      const ws = await api.workspace({ id: 'probe', name, url: normalized(url), token: token.trim() });
      testResult = `Connected to ${ws.name} (v${ws.version})`;
      if (!name.trim()) name = ws.name;
    } catch (err) {
      testResult = `Failed: ${(err as Error).message}`;
    } finally {
      testing = false;
    }
  }

  function add() {
    if (!canAdd) return;
    settings.addServer({ name: name.trim(), url, token: token.trim() });
    name = '';
    url = '';
    token = '';
    testResult = null;
  }

  function normalized(value: string) {
    let v = value.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\//i.test(v)) v = `http://${v}`;
    return v;
  }

  function saveKey() {
    settings.openaiKey = openaiKey;
  }
</script>

<div class="screen" class:screen--slide={!embedded} class:embedded>
  {#if !embedded}
    <div class="topbar">
      <button class="round round--filled" aria-label="Back" onclick={() => router.back({ name: 'workspaces' })}>
        <Icon name="back" color="var(--ink-icon)" />
      </button>
    </div>
  {/if}
  <div class="heading">
    <div class="title">Settings</div>
    <div class="subtitle">Machines and voice</div>
  </div>

  <div class="scroll body">
    <div class="section">Machines</div>
    <div class="card group">
      {#each settings.servers as server (server.id)}
        <div class="server">
          <div class="server-main">
            <div class="server-name">{server.name}</div>
            <div class="server-url">{server.url}</div>
          </div>
          <button class="remove" aria-label="Remove" onclick={() => settings.removeServer(server.id)}>
            <Icon name="close" color="var(--muted-2)" />
          </button>
        </div>
      {:else}
        <div class="hint">No machine configured yet.</div>
      {/each}
    </div>

    <div class="section">Add a machine</div>
    <div class="card form">
      <input class="field" placeholder="Name (e.g. dev-machine)" bind:value={name} autocapitalize="off" />
      <input class="field" placeholder="URL (e.g. https://dev-machine.example.invalid)" bind:value={url} autocapitalize="off" autocorrect="off" inputmode="url" />
      <input class="field" placeholder="Token" bind:value={token} autocapitalize="off" autocorrect="off" />
      {#if testResult}
        <div class="result" class:bad={testResult.startsWith('Failed')}>{testResult}</div>
      {/if}
      <div class="actions">
        <button class="btn" disabled={testing || !url || !token} onclick={test}>{testing ? 'Testing…' : 'Test'}</button>
        <button class="btn btn--dark" disabled={!canAdd} onclick={add}>Add</button>
      </div>
    </div>

    <div class="section">Voice</div>
    <div class="card form">
      <div class="hint">OpenAI API key, stored only in this browser and used for live transcription.</div>
      <input class="field" placeholder="sk-…" bind:value={openaiKey} onblur={saveKey} autocapitalize="off" autocorrect="off" type="password" />
    </div>
  </div>
</div>

<style>
  .embedded {
    background: #fbfaf8;
  }
  .embedded .heading,
  .embedded .body {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
  }
  .embedded .heading {
    padding-top: 28px;
  }
  .heading {
    padding: 0 22px 2px;
  }
  .body {
    padding: 12px 14px calc(var(--safe-bottom) + 40px);
  }
  .section {
    padding: 14px 8px 7px;
    font-size: 12.5px;
    color: var(--muted-2);
    letter-spacing: 0.1px;
  }
  .group {
    overflow: hidden;
  }
  .server {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 15px;
  }
  .server + .server {
    border-top: 1px solid var(--hairline);
  }
  .server-main {
    flex: 1;
    min-width: 0;
  }
  .server-name {
    font-size: 15px;
    font-weight: 500;
    letter-spacing: -0.2px;
  }
  .server-url {
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--muted-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remove {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .remove:active {
    background: var(--press);
  }
  .form {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hint {
    padding: 4px 3px;
    font-size: 12.5px;
    color: var(--muted-2);
    line-height: 1.4;
  }
  .result {
    padding: 2px 3px;
    font-size: 12.5px;
    color: var(--green);
  }
  .result.bad {
    color: var(--red);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 2px;
  }
  .btn {
    padding: 8px 16px;
    border-radius: 999px;
    background: var(--press);
    font-size: 13.5px;
    font-weight: 500;
    color: var(--ink-control);
  }
  .btn:disabled {
    opacity: 0.45;
  }
  .btn--dark {
    background: var(--dark);
    color: #fff;
  }
</style>
