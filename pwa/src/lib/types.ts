export type TaskState = 'working' | 'done' | 'no_changes' | 'failed' | 'pending';

export interface TaskSummary {
  id: string;
  repo: string;
  title: string;
  pinned: boolean;
  state: TaskState;
  plus: number;
  minus: number;
  created_at: number;
  updated_at: number;
}

export type RunStatus = 'settled' | 'error' | 'aborted';

export type Turn =
  | { role: 'user'; text: string; at: number }
  | { role: 'agent'; text: string; files: string[]; at: number; status: RunStatus };

export interface TouchedFile {
  path: string;
  plus: number;
  minus: number;
}

export interface TaskDetail extends TaskSummary {
  model: string | null;
  branch: string | null;
  touched_files: TouchedFile[];
  turns: Turn[];
}

export interface FileDiff extends TouchedFile {
  patch: string;
}

export interface Repo {
  name: string;
  path: string;
  is_git: boolean;
  branch: string | null;
}

export interface Workspace {
  name: string;
  version: string;
  uptime_secs: number;
  agents_running: number;
}

export type RunEvent =
  | { kind: 'agent_start' }
  | { kind: 'status'; text: string }
  | { kind: 'text_delta'; delta: string }
  | { kind: 'file_touched'; path: string }
  | { kind: 'settled'; turn: Turn }
  | { kind: 'error'; message: string }
  | { kind: 'ui_request'; request: UiRequest };

export interface UiRequest {
  id: string;
  method: 'select' | 'confirm' | 'input' | 'editor' | 'notify' | 'setStatus' | 'setWidget' | 'setTitle' | 'set_editor_text';
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

export type ServerEvent =
  | { type: 'task_upsert'; task: TaskSummary }
  | { type: 'task_removed'; id: string }
  | { type: 'run_event'; task_id: string; event: RunEvent };
