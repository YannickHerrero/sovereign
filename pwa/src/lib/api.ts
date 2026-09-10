import type { Server } from './settings.svelte';
import type { ModelList, ModelRef, PiModel, ImageContent, FileDiff, QueuedMessage, Repo, ServerEvent, TaskDetail, TaskSummary, Workspace } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(server: Server, method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${server.url}/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${server.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = ((await res.json()) as { error?: string }).error ?? message;
      } catch {
        // Non-JSON error body.
      }
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    // Accepted commands (202) also return an empty body, not JSON.
    const text = await res.text();
    return text.trim() ? (JSON.parse(text) as T) : (undefined as T);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  workspace: (s: Server, timeoutMs = 4000) => request<Workspace>(s, 'GET', '/workspace', undefined, timeoutMs),
  repos: (s: Server) => request<Repo[]>(s, 'GET', '/repos'),
  models: (s: Server, repo: string) =>
    request<ModelList>(s, 'GET', `/models?repo=${encodeURIComponent(repo)}`, undefined, 65000),
  taskModels: (s: Server, id: string) =>
    request<ModelList>(s, 'GET', `/tasks/${id}/models`, undefined, 95000),
  setModel: (s: Server, id: string, model: ModelRef) =>
    request<PiModel>(s, 'POST', `/tasks/${id}/model`, model, 95000),
  tasks: (s: Server) => request<TaskSummary[]>(s, 'GET', '/tasks'),
  task: (s: Server, id: string) => request<TaskDetail>(s, 'GET', `/tasks/${id}`),
  diff: (s: Server, id: string) => request<{ files: FileDiff[] }>(s, 'GET', `/tasks/${id}/diff`),
  /** Changed files with stats but no patches; pair with `fileDiff` to load lazily. */
  diffSummary: (s: Server, id: string) => request<{ files: FileDiff[] }>(s, 'GET', `/tasks/${id}/diff?summary=true`),
  fileDiff: (s: Server, id: string, path: string) =>
    request<{ files: FileDiff[] }>(s, 'GET', `/tasks/${id}/diff?path=${encodeURIComponent(path)}`),
  /** Working-tree text of a touched file (plain text, not JSON). */
  file: async (s: Server, id: string, path: string): Promise<string> => {
    const res = await fetch(`${s.url}/api/tasks/${id}/file?path=${encodeURIComponent(path)}`, {
      headers: { Authorization: `Bearer ${s.token}` },
    });
    if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText);
    // An older server without this route falls back to the app shell: never show that as code.
    if (!(res.headers.get('content-type') ?? '').startsWith('text/plain')) {
      throw new ApiError(res.status, 'This server does not provide file contents yet');
    }
    return res.text();
  },
  createTask: (s: Server, repo: string, message: string, images: ImageContent[] = [], model?: ModelRef | null) =>
    request<TaskSummary>(s, 'POST', '/tasks', { repo, message, images, ...(model ? { model } : {}) }, 125000),
  /** `queued` is set when the server held the message back; older servers return no body. */
  prompt: (s: Server, id: string, message: string, images: ImageContent[] = []) =>
    request<{ queued: QueuedMessage | null } | undefined>(s, 'POST', `/tasks/${id}/prompt`, { message, images }),
  steer: (s: Server, id: string, messageId: string) =>
    request<void>(s, 'POST', `/tasks/${id}/queue/${messageId}/steer`),
  removeQueued: (s: Server, id: string, messageId: string) =>
    request<void>(s, 'DELETE', `/tasks/${id}/queue/${messageId}`),
  /** Resolves with the queued messages the server dropped along with the run. */
  abort: (s: Server, id: string) => request<QueuedMessage[] | undefined>(s, 'POST', `/tasks/${id}/abort`),
  patchTask: (s: Server, id: string, patch: { pinned?: boolean; title?: string; seen?: true }) =>
    request<TaskSummary>(s, 'PATCH', `/tasks/${id}`, patch),
  deleteTask: (s: Server, id: string) => request<void>(s, 'DELETE', `/tasks/${id}`),
  uiResponse: (s: Server, id: string, response: Record<string, unknown>) =>
    request<void>(s, 'POST', `/tasks/${id}/ui-response`, response),
};

/** WebSocket feed of a server's events, reconnecting with backoff until closed. */
export function connectEvents(server: Server, onEvent: (event: ServerEvent) => void, onOpen?: () => void) {
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    if (closed) return;
    const url = server.url.replace(/^http/, 'ws') + `/api/ws?token=${encodeURIComponent(server.token)}`;
    socket = new WebSocket(url);
    socket.onopen = () => {
      attempt = 0;
      onOpen?.();
    };
    socket.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data as string) as ServerEvent);
      } catch {
        // Ignore malformed frames.
      }
    };
    socket.onclose = () => {
      socket = null;
      if (closed) return;
      const delay = Math.min(10000, 500 * 2 ** attempt++);
      timer = setTimeout(open, delay);
    };
    socket.onerror = () => socket?.close();
  };
  open();

  return () => {
    closed = true;
    clearTimeout(timer);
    socket?.close();
  };
}
