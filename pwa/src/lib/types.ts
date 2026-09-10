export type TaskState = 'blocked' | 'working' | 'done' | 'no_changes' | 'failed' | 'pending';

export type AgentKind = 'pi' | 'claude';

export const AGENT_LABEL: Record<AgentKind, string> = { pi: 'pi', claude: 'Claude Code' };

export interface TaskSummary {
  id: string;
  agent: AgentKind;
  repo: string;
  title: string;
  pinned: boolean;
  state: TaskState;
  plus: number;
  minus: number;
  created_at: number;
  updated_at: number;
  /** Absent on older servers. */
  last_message_at?: number;
  /** The task finished a run the user has not opened since. */
  unread: boolean;
}

export type RunStatus = 'settled' | 'error' | 'aborted' | 'interrupted';

export interface ModelRef {
  agent: AgentKind;
  provider: string;
  id: string;
}

export interface Model extends ModelRef {
  name: string;
  input: string[];
}

/** Kept as an alias while call sites migrate. */
export type PiModel = Model;

export interface ModelList {
  models: Model[];
  current: Model | null;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type Turn =
  | { role: 'user'; text: string; at: number; images?: ImageContent[] }
  | { role: 'agent'; text: string; files: string[]; at: number; status: RunStatus }
  | { role: 'system'; text: string; at: number };

/** A message the server holds until the current run ends. */
export interface QueuedMessage {
  id: string;
  text: string;
  images: ImageContent[];
  at: number;
}

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
  /** Absent on older servers. */
  queued?: QueuedMessage[];
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
  agents: AgentKind[];
}

export type RunEvent =
  | { kind: 'agent_start' }
  | { kind: 'status'; text: string }
  | { kind: 'text_delta'; delta: string }
  | { kind: 'file_touched'; path: string }
  | { kind: 'settled'; turn: Turn }
  | { kind: 'note'; text: string; at: number }
  | { kind: 'error'; message: string }
  | { kind: 'ui_request'; request: Record<string, unknown> }
  | { kind: 'model_changed'; model: Model }
  | { kind: 'queue_update'; queued: QueuedMessage[] }
  | { kind: 'user_turn'; turn: Turn };

export type ServerEvent =
  | { type: 'task_upsert'; task: TaskSummary }
  | { type: 'task_removed'; id: string }
  | { type: 'run_event'; task_id: string; event: RunEvent };
