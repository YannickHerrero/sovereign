import type { Server } from './settings.svelte';
import type { TaskSummary } from './types';

export interface PaletteEntry {
  kind: 'action' | 'discussion' | 'machine';
  action?: PaletteAction;
  aliases?: string[];
  wsId: string;
  taskId?: string;
  title: string;
  subtitle: string;
  updatedAt: number;
  repo?: string;
}

export type PaletteAction = 'diff' | 'conversation' | 'width' | 'split' | 'unified' | 'new' | 'settings' | 'sidebar' | 'pin' | 'copy';

export interface PaletteContext {
  view: 'workspaces' | 'tasks' | 'chat' | 'diff' | 'settings';
  desktop: boolean;
  wsId?: string;
  taskId?: string;
  pinned?: boolean;
  wide: boolean;
  sidebarCollapsed: boolean;
  diffMode: 'unified' | 'split';
}

/** Only offer commands that can affect the current screen. */
export function paletteActions(context: PaletteContext): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  const add = (action: PaletteAction, title: string, aliases: string[], subtitle = 'Action') => {
    entries.push({ kind: 'action', action, title, aliases, subtitle, wsId: context.wsId ?? '', taskId: context.taskId, updatedAt: 0 });
  };
  const conversation = Boolean(context.wsId && context.taskId && (context.view === 'chat' || context.view === 'diff'));
  if (conversation) {
    if (context.view === 'chat') add('diff', 'View diff', ['diff', 'changes', 'voir le diff', 'modifications']);
    else add('conversation', 'Back to conversation', ['conversation', 'chat', 'retour à la conversation']);
    if (context.pinned !== undefined) add('pin', context.pinned ? 'Unpin discussion' : 'Pin discussion',
      context.pinned ? ['unpin', 'désépingler'] : ['pin', 'épingler']);
    add('copy', 'Copy discussion link', ['copy link', 'copier le lien', 'url']);
  }
  if (context.desktop) {
    if (context.wsId && (context.view === 'chat' || context.view === 'tasks')) {
      add('width', context.wide ? 'Use standard width' : 'Use full width',
        ['full width', 'standard width', 'pleine largeur', 'réduire la largeur'], context.wide ? 'Currently full width' : 'Currently standard width');
    }
    if (context.view === 'diff' && conversation) {
      if (context.diffMode !== 'split') add('split', 'Show split diff', ['split', 'side by side', 'côte à côte']);
      if (context.diffMode !== 'unified') add('unified', 'Show unified diff', ['unified', 'unifié']);
    }
    add('sidebar', context.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
      ['sidebar', 'barre latérale', context.sidebarCollapsed ? 'afficher' : 'masquer']);
  }
  if (context.wsId) add('new', 'New discussion', ['new conversation', 'nouvelle discussion', 'nouvelle conversation']);
  if (context.view !== 'settings') add('settings', 'Open settings', ['settings', 'réglages', 'paramètres']);
  return entries;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Lower scores are better. Characters must appear in order, but need not be adjacent. */
export function fuzzyScore(text: string, query: string): number | null {
  text = normalize(text);
  query = normalize(query);
  if (!query) return 0;
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  const substring = text.indexOf(query);
  if (substring >= 0) return 2 + substring / (text.length + 1);
  let position = -1;
  let gaps = 0;
  for (const char of query.replace(/\s/g, '')) {
    const next = text.indexOf(char, position + 1);
    if (next < 0) return null;
    gaps += next - position - 1;
    position = next;
  }
  return 3 + gaps;
}

export function paletteEntries(tasks: TaskSummary[], servers: Server[], wsId?: string): PaletteEntry[] {
  return [
    ...(wsId ? tasks : []).map((task): PaletteEntry => ({
      kind: 'discussion', wsId: wsId!, taskId: task.id, title: task.title, repo: task.repo,
      subtitle: `${task.repo} · ${task.state}`, updatedAt: task.last_message_at ?? task.updated_at,
    })),
    ...servers.map((server): PaletteEntry => ({
      kind: 'machine', wsId: server.id, title: server.name,
      subtitle: server.id === wsId ? 'Current machine' : 'Switch machine', updatedAt: 0,
    })),
  ];
}

export function searchPalette(entries: PaletteEntry[], query: string): PaletteEntry[] {
  return entries.map((entry) => {
    const fields = [entry.title, ...(entry.aliases ?? [])];
    if (entry.kind === 'discussion') fields.push(`${entry.title} ${entry.repo ?? ''}`);
    const scores = fields.map((field) => fuzzyScore(field, query)).filter((score): score is number => score !== null);
    return { entry, score: scores.length ? Math.min(...scores) : null };
  }).filter((item): item is { entry: PaletteEntry; score: number } => item.score !== null)
    .sort((a, b) => {
      const category = { action: 0, discussion: 1, machine: 2 };
      if (!query.trim()) return category[a.entry.kind] - category[b.entry.kind] || b.entry.updatedAt - a.entry.updatedAt;
      return a.score - b.score || category[a.entry.kind] - category[b.entry.kind]
        || b.entry.updatedAt - a.entry.updatedAt || a.entry.title.localeCompare(b.entry.title);
    })
    .map(({ entry }) => entry);
}
