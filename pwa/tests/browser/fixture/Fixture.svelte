<script lang="ts">
  import { onMount } from 'svelte';
  import Thread from '../../../src/components/Thread.svelte';
  import { ChatSession } from '../../../src/lib/chat.svelte';
  import { WorkspaceStore } from '../../../src/lib/workspace.svelte';

  const store = new WorkspaceStore({ id: 'test', name: 'Test', url: location.origin, token: 'test' });
  const session = new ChatSession(store, 'markdown');
  const variant = new URLSearchParams(location.search).get('variant') === 'desktop' ? 'desktop' : 'mobile';
  let delta = $state('');
  onMount(() => { void session.load(); });

  function finish() {
    session.handle({
      kind: 'settled',
      turn: { role: 'agent', text: session.live?.text ?? '', files: [], status: 'settled', at: Date.now() },
    });
  }
</script>

<div class="screen">
  <div class="controls">
    <button onclick={() => session.handle({ kind: 'agent_start' })}>Start</button>
    <textarea aria-label="Delta" bind:value={delta}></textarea>
    <button onclick={() => session.handle({ kind: 'text_delta', delta })}>Append</button>
    <button onclick={finish}>Finish</button>
  </div>
  <Thread {session} {variant} />
</div>

<style>
  .controls { display: flex; gap: 8px; padding: 8px; }
  textarea { min-width: 0; flex: 1; }
</style>
