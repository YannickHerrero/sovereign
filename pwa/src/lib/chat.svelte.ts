import { api } from './api';
import { ago } from './format';
import { isActive } from './tasks';
import { answerBody, normalize, type AgentRequest, type Answers } from './requests';
import type { ModelRef, FileDiff, ImageContent, RunEvent, TaskDetail, TaskSummary, TouchedFile, Turn } from './types';
import type { WorkspaceStore } from './workspace.svelte';

export interface Live {
  status: string;
  text: string;
  files: string[];
}

/**
 * Everything a conversation view needs, independent of layout: task detail, turns, the live
 * run being streamed, diff loading and task actions. Mobile and desktop views render it.
 */
export class ChatSession {
  detail = $state<TaskDetail | null>(null);
  turns = $state<Turn[]>([]);
  live = $state<Live | null>(null);
  error = $state<string | null>(null);
  diffOpen = $state(false);
  diffFiles = $state<FileDiff[]>([]);
  diffLoading = $state(false);
  now = $state(Date.now());
  /** Questions the agent is waiting on, oldest first. */
  requests = $state<AgentRequest[]>([]);
  /** Last fire-and-forget notice from the agent (pi `notify`). */
  notice = $state<string | null>(null);

  private appendListeners = new Set<() => void>();

  constructor(
    readonly store: WorkspaceStore,
    readonly taskId: string,
  ) {}

  get summary(): TaskSummary | TaskDetail | undefined {
    return this.store.task(this.taskId) ?? this.detail ?? undefined;
  }

  get working(): boolean {
    return (this.summary !== undefined && isActive(this.summary)) || this.live !== null;
  }

  get touched(): TouchedFile[] {
    return this.detail?.touched_files ?? [];
  }

  get totalPlus(): number {
    return this.touched.reduce((a, f) => a + f.plus, 0);
  }

  get totalMinus(): number {
    return this.touched.reduce((a, f) => a + f.minus, 0);
  }

  get lastAgentIndex(): number {
    return this.turns.map((t) => t.role).lastIndexOf('agent');
  }

  /** Loads the task, follows its run events and refreshes relative times. Returns a cleanup. */
  start(): () => void {
    const release = this.store.acquire();
    void this.load();
    const timer = setInterval(() => (this.now = Date.now()), 30000);
    const unsubscribe = this.store.onRun((id, event) => {
      if (id === this.taskId) this.handle(event);
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
      release();
    };
  }

  /** Called whenever content is appended, so the view can scroll to the end. */
  onAppend(listener: () => void): () => void {
    this.appendListeners.add(listener);
    return () => this.appendListeners.delete(listener);
  }

  async load() {
    try {
      const detail = await api.task(this.store.server, this.taskId);
      this.detail = detail;
      this.turns = detail.turns;
      const first = this.store.firstPrompt(this.taskId);
      if (this.turns.length === 0 && first) this.turns = [{ role: 'user', ...first, at: detail.created_at }];
      this.error = null;
      if (detail.state === 'working' && !this.live) this.live = { status: 'Working…', text: '', files: [] };
      if (detail.unread) void this.markSeen();
      this.appended();
    } catch (err) {
      this.error = (err as Error).message;
    }
  }

  handle(event: RunEvent) {
    switch (event.kind) {
      case 'agent_start':
        this.live = { status: 'Thinking…', text: '', files: [] };
        break;
      case 'status':
        if (this.live) this.live.status = event.text;
        break;
      case 'text_delta':
        if (!this.live) this.live = { status: 'Writing…', text: '', files: [] };
        this.live.text += event.delta;
        break;
      case 'file_touched':
        if (this.live && !this.live.files.includes(event.path)) this.live.files.push(event.path);
        break;
      case 'settled':
        this.live = null;
        this.turns.push(event.turn);
        void this.refreshStats();
        break;
      case 'error':
        this.error = event.message;
        break;
      case 'ui_request': {
        const agent = this.summary?.agent ?? 'pi';
        const request = normalize(agent, event.request);
        if (request) {
          this.requests.push(request);
        } else if (agent === 'pi' && event.request.method === 'notify') {
          this.notice = String(event.request.message ?? '');
        }
        break;
      }
      case 'model_changed':
        if (this.detail) this.detail.model = event.model.id;
        return;
    }
    this.appended();
  }

  async send(text: string, images: ImageContent[]) {
    this.error = null;
    const optimistic: Turn = { role: 'user', text, images, at: Date.now() };
    this.turns.push(optimistic);
    this.appended();
    try {
      await api.prompt(this.store.server, this.taskId, text, images);
    } catch (err) {
      this.turns = this.turns.filter((t) => t !== optimistic);
      this.error = (err as Error).message;
      throw err;
    }
  }

  /** Sends the user's answers (or a dismissal when null) back to the agent. */
  async answer(request: AgentRequest, answers: Answers | null) {
    try {
      await api.uiResponse(this.store.server, this.taskId, answerBody(request, answers));
      this.requests = this.requests.filter((r) => r !== request);
    } catch (err) {
      this.error = (err as Error).message;
    }
  }

  async models() {
    const list = await api.taskModels(this.store.server, this.taskId);
    if (this.detail) this.detail.model = list.current?.id ?? null;
    return list;
  }

  async changeModel(model: ModelRef) {
    const selected = await api.setModel(this.store.server, this.taskId, model);
    if (this.detail) this.detail.model = selected.id;
  }

  async openDiff() {
    this.diffOpen = true;
    this.diffLoading = true;
    try {
      this.diffFiles = (await api.diff(this.store.server, this.taskId)).files;
    } catch (err) {
      this.error = (err as Error).message;
    } finally {
      this.diffLoading = false;
    }
  }

  closeDiff() {
    this.diffOpen = false;
  }

  async togglePin() {
    const summary = this.summary;
    if (!summary) return;
    try {
      this.store.upsert(await api.patchTask(this.store.server, this.taskId, { pinned: !summary.pinned }));
    } catch (err) {
      this.error = (err as Error).message;
    }
  }

  async rename(title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      this.store.upsert(await api.patchTask(this.store.server, this.taskId, { title: trimmed }));
    } catch (err) {
      this.error = (err as Error).message;
    }
  }

  async abort() {
    try {
      await api.abort(this.store.server, this.taskId);
    } catch (err) {
      this.error = (err as Error).message;
    }
  }

  /** Deletes the task; resolves true when the caller should navigate away. */
  async remove(): Promise<boolean> {
    try {
      await api.deleteTask(this.store.server, this.taskId);
      this.store.remove(this.taskId);
      return true;
    } catch (err) {
      this.error = (err as Error).message;
      return false;
    }
  }

  metaLabel(turn: Extract<Turn, { role: 'agent' }>): string {
    const when = ago(turn.at, this.now);
    const word = turn.status === 'settled' ? 'Finished' : turn.status === 'aborted' ? 'Stopped' : turn.status === 'interrupted' ? 'Interrupted' : 'Failed';
    return when === 'now' ? `${word} now` : `${word} ${when}`;
  }

  statsFor(path: string): TouchedFile | undefined {
    return this.touched.find((f) => f.path === path);
  }

  private async refreshStats() {
    try {
      const fresh = await api.task(this.store.server, this.taskId);
      this.detail = fresh;
      this.turns = fresh.turns;
      if (fresh.unread) void this.markSeen();
    } catch {
      // Keep what we have.
    }
  }

  private async markSeen() {
    try {
      this.store.upsert(await api.patchTask(this.store.server, this.taskId, { seen: true }));
    } catch {
      // The dot stays coloured until the next visit; not worth an error banner.
    }
  }

  private appended() {
    for (const listener of this.appendListeners) listener();
  }
}
