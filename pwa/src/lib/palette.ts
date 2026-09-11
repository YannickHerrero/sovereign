import type { Server } from './settings.svelte';
import type { TaskSummary } from './types';

export interface PaletteEntry {
  kind: 'discussion' | 'machine';
  wsId: string;
  taskId?: string;
  title: string;
  subtitle: string;
  updatedAt: number;
  repo?: string;
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
    const title = fuzzyScore(entry.title, query);
    const combined = entry.kind === 'discussion' ? fuzzyScore(`${entry.title} ${entry.repo ?? ''}`, query) : null;
    const score = title === null ? combined : combined === null ? title : Math.min(title, combined);
    return { entry, score };
  }).filter((item): item is { entry: PaletteEntry; score: number } => item.score !== null)
    .sort((a, b) => a.score - b.score || b.entry.updatedAt - a.entry.updatedAt || a.entry.title.localeCompare(b.entry.title))
    .map(({ entry }) => entry);
}
