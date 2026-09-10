import type { DiffLine } from './parse';

/** One row of the split view: a cell per side, either may be empty (spacer). */
export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Aligns a hunk's lines side by side: context lines span both columns, and each run of
 * deletions is paired with the run of additions that follows it.
 */
export function splitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === 'del') dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === 'add') adds.push(lines[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return rows;
}
