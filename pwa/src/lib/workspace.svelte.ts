import { api, connectEvents } from './api';
import { settings, type Server } from './settings.svelte';
import type { ImageContent, RunEvent, ServerEvent, TaskSummary } from './types';

type RunListener = (taskId: string, event: RunEvent) => void;

/** Live view of one server: task list kept in sync over WebSocket, plus a run-event fan-out. */
export class WorkspaceStore {
  tasks = $state<TaskSummary[]>([]);
  loaded = $state(false);
  connected = $state(false);
  error = $state<string | null>(null);

  private listeners = new Set<RunListener>();
  /** First prompt of tasks created from this client, shown until the harness has persisted it. */
  private firstPrompts = new Map<string, { text: string; images: ImageContent[] }>();
  private disconnect: (() => void) | null = null;
  private refCount = 0;

  constructor(readonly server: Server) {}

  /** Reference-counted: screens call `acquire` on mount and the returned release on unmount. */
  acquire(): () => void {
    if (this.refCount++ === 0) this.connect();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.refCount === 0) this.close();
    };
  }

  onRun(listener: RunListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  task(id: string): TaskSummary | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  rememberFirstPrompt(taskId: string, text: string, images: ImageContent[] = []) {
    this.firstPrompts.set(taskId, { text, images });
  }

  firstPrompt(taskId: string) {
    return this.firstPrompts.get(taskId);
  }

  /** Repo the "new task" pane should preselect, set by a project section's "+". Reactive so an
   *  already mounted pane picks it up. */
  proposedRepo = $state<string | null>(null);

  async refresh() {
    try {
      this.tasks = await api.tasks(this.server);
      this.error = null;
      settings.updateServer(this.server.id, { lastSeen: Date.now() });
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.loaded = true;
    }
  }

  upsert(task: TaskSummary) {
    const index = this.tasks.findIndex((t) => t.id === task.id);
    if (index >= 0) this.tasks[index] = task;
    else this.tasks.unshift(task);
  }

  remove(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
  }

  private connect() {
    void this.refresh();
    this.disconnect = connectEvents(
      this.server,
      (event) => this.handle(event),
      () => {
        this.connected = true;
        // Events emitted while disconnected are gone: resync the list.
        void this.refresh();
      },
    );
  }

  private close() {
    this.disconnect?.();
    this.disconnect = null;
    this.connected = false;
  }

  private handle(event: ServerEvent) {
    switch (event.type) {
      case 'task_upsert':
        this.upsert(event.task);
        break;
      case 'task_removed':
        this.remove(event.id);
        break;
      case 'run_event':
        for (const listener of this.listeners) listener(event.task_id, event.event);
        break;
    }
  }
}

const stores = new Map<string, WorkspaceStore>();

export function workspaceStore(serverId: string): WorkspaceStore | undefined {
  const server = settings.server(serverId);
  if (!server) return undefined;
  let store = stores.get(serverId);
  if (!store || store.server.url !== server.url || store.server.token !== server.token) {
    store = new WorkspaceStore(server);
    stores.set(serverId, store);
  }
  return store;
}
