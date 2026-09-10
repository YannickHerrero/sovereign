/** Unified diff parsing: one patch (git header included) becomes hunks of numbered lines. */

export type LineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: LineKind;
  /** Line number on the old side; absent for additions. */
  oldNo?: number;
  /** Line number on the new side; absent for deletions. */
  newNo?: number;
  text: string;
}

export interface Hunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedPatch {
  hunks: Hunk[];
  binary: boolean;
  /** Old and new counts after each hunk, handy for expansion math. */
  oldEnd: number;
  newEnd: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parsePatch(patch: string): ParsedPatch {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let binary = false;
  for (const raw of patch.split('\n')) {
    const match = HUNK_RE.exec(raw);
    if (match) {
      current = {
        header: raw,
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      };
      oldNo = current.oldStart;
      newNo = current.newStart;
      hunks.push(current);
      continue;
    }
    if (!current) {
      if (raw.startsWith('Binary files') || raw.startsWith('GIT binary patch')) binary = true;
      continue;
    }
    if (raw.startsWith('\\ No newline')) continue;
    if (raw === '' ) continue;
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === '+') {
      current.lines.push({ kind: 'add', newNo: newNo++, text });
    } else if (marker === '-') {
      current.lines.push({ kind: 'del', oldNo: oldNo++, text });
    } else if (marker === ' ') {
      current.lines.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text });
    } else {
      // A new file header after hunks (should not happen per file) ends the current hunk.
      current = null;
    }
  }
  const last = hunks[hunks.length - 1];
  return {
    hunks,
    binary,
    oldEnd: last ? last.oldStart + last.oldCount - 1 : 0,
    newEnd: last ? last.newStart + last.newCount - 1 : 0,
  };
}

/** Context lines to show between `before` and `after` (or before the first / after the last). */
export interface Gap {
  /** New-side line numbers, inclusive. */
  fromNew: number;
  toNew: number;
  /** Offset to convert a new-side number to the old side inside this gap. */
  oldOffset: number;
}

/** Gap preceding hunk `index` (index === hunks.length means the trailing gap). */
export function gapBefore(hunks: Hunk[], index: number, totalNewLines: number | null): Gap | null {
  const prev = hunks[index - 1];
  const next = hunks[index];
  const fromNew = prev ? prev.newStart + prev.newCount : 1;
  const toNew = next ? next.newStart - 1 : totalNewLines ?? 0;
  if (toNew < fromNew) return null;
  const oldOffset = prev ? prev.oldStart + prev.oldCount - (prev.newStart + prev.newCount) : next ? next.oldStart - next.newStart : 0;
  return { fromNew, toNew, oldOffset };
}

/** Builds context lines for a gap from the working-tree file contents. */
export function contextLines(fileLines: string[], gap: Gap, fromNew = gap.fromNew, toNew = gap.toNew): DiffLine[] {
  const out: DiffLine[] = [];
  for (let n = fromNew; n <= toNew && n - 1 < fileLines.length; n++) {
    out.push({ kind: 'context', oldNo: n + gap.oldOffset, newNo: n, text: fileLines[n - 1] });
  }
  return out;
}
