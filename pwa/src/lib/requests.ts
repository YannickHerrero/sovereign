import type { AgentKind } from './types';

/** One thing the agent wants from the user, normalized across backends. */
export interface Question {
  key: string;
  kind: 'select' | 'confirm' | 'input' | 'editor';
  title: string;
  message?: string;
  options?: { label: string; description?: string }[];
  multi?: boolean;
  placeholder?: string;
  prefill?: string;
}

export interface AgentRequest {
  /** Backend request id, echoed back in the answer. */
  id: string;
  agent: AgentKind;
  questions: Question[];
  /** Raw payload, needed to build the backend-specific answer. */
  raw: Record<string, unknown>;
}

/** Answers keyed by question key: selected labels, free text, or "yes" / "no" for confirms. */
export type Answers = Record<string, string[] | string | boolean>;

/**
 * Turns a raw `ui_request` payload into questions. Returns null for fire-and-forget requests
 * (notifications, status lines) that need no answer.
 */
export function normalize(agent: AgentKind, raw: Record<string, unknown>): AgentRequest | null {
  if (agent === 'pi') return normalizePi(raw);
  return normalizeClaude(raw);
}

function normalizePi(raw: Record<string, unknown>): AgentRequest | null {
  const id = String(raw.id ?? '');
  const method = String(raw.method ?? '');
  const title = String(raw.title ?? 'The agent needs an answer');
  const base = { id, agent: 'pi' as const, raw };
  switch (method) {
    case 'select':
      return {
        ...base,
        questions: [{ key: 'value', kind: 'select', title, options: ((raw.options as string[]) ?? []).map((label) => ({ label })) }],
      };
    case 'confirm':
      return { ...base, questions: [{ key: 'value', kind: 'confirm', title, message: raw.message as string | undefined }] };
    case 'input':
      return { ...base, questions: [{ key: 'value', kind: 'input', title, placeholder: raw.placeholder as string | undefined }] };
    case 'editor':
      return { ...base, questions: [{ key: 'value', kind: 'editor', title, prefill: raw.prefill as string | undefined }] };
    default:
      return null;
  }
}

/** Claude Code delivers AskUserQuestion as a permission request for that tool. */
function normalizeClaude(raw: Record<string, unknown>): AgentRequest | null {
  const request = raw.request as Record<string, unknown> | undefined;
  if (!request || request.subtype !== 'can_use_tool' || request.tool_name !== 'AskUserQuestion') return null;
  const input = request.input as { questions?: Array<Record<string, unknown>> } | undefined;
  const questions: Question[] = (input?.questions ?? []).map((q, index) => ({
    key: String(q.question ?? index),
    kind: 'select',
    title: String(q.header ?? 'Question'),
    message: String(q.question ?? ''),
    multi: q.multiSelect === true,
    options: ((q.options as Array<{ label: string; description?: string }>) ?? []).map((o) => ({ label: o.label, description: o.description })),
  }));
  if (!questions.length) return null;
  return { id: String(raw.request_id ?? ''), agent: 'claude', questions, raw };
}

/** Builds the backend-specific body for `POST /tasks/:id/ui-response`. */
export function answerBody(request: AgentRequest, answers: Answers | null): Record<string, unknown> {
  if (request.agent === 'pi') {
    if (answers === null) return { id: request.id, cancelled: true };
    const value = answers.value;
    if (typeof value === 'boolean') return { id: request.id, confirmed: value };
    return { id: request.id, value: Array.isArray(value) ? value[0] ?? '' : (value ?? '') };
  }
  const requestInput = ((request.raw.request as Record<string, unknown>)?.input as Record<string, unknown>) ?? {};
  if (answers === null) {
    return { subtype: 'success', request_id: request.id, response: { behavior: 'deny', message: 'The user dismissed the question.' } };
  }
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    flat[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return {
    subtype: 'success',
    request_id: request.id,
    response: { behavior: 'allow', updatedInput: { ...requestInput, answers: flat } },
  };
}
