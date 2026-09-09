import type { Server } from './settings.svelte';
import type { FileDiff, Repo, ServerEvent, TaskDetail, TaskSummary, Workspace } from './types';

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
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  workspace: (s: Server, timeoutMs = 4000) => request<Workspace>(s, 'GET', '/workspace', undefined, timeoutMs),
  repos: (s: Server) => request<Repo[]>(s, 'GET', '/repos'),
  tasks: (s: Server) => request<TaskSummary[]>(s, 'GET', '/tasks'),
  task: (s: Server, id: string) => request<TaskDetail>(s, 'GET', `/tasks/${id}`),
  diff: (s: Server, id: string) => request<{ files: FileDiff[] }>(s, 'GET', `/tasks/${id}/diff`),
  createTask: (s: Server, repo: string, message: string) =>
    request<TaskSummary>(s, 'POST', '/tasks', { repo, message }),
  prompt: (s: Server, id: string, message: string) => request<void>(s, 'POST', `/tasks/${id}/prompt`, { message }),
  abort: (s: Server, id: string) => request<void>(s, 'POST', `/tasks/${id}/abort`),
  patchTask: (s: Server, id: string, patch: { pinned?: boolean; title?: string }) =>
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
