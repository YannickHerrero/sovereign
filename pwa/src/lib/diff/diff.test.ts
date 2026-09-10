import { describe, expect, it } from 'vitest';
import { contextLines, gapBefore, parsePatch } from './parse';
import { splitRows } from './sideBySide';
import { buildTree, filterPaths } from './tree';

const PATCH = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,4 +1,5 @@',
  " import a from 'a';",
  "-import b from 'b';",
  "+import b from 'bee';",
  "+import c from 'c';",
  ' ',
  ' export const x = 1;',
  '@@ -20,3 +21,4 @@ function tail() {',
  '   return 1;',
  ' }',
  '+// end',
  ' ',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('parsePatch', () => {
  it('numbers lines on both sides and keeps hunk metadata', () => {
    const parsed = parsePatch(PATCH);
    expect(parsed.binary).toBe(false);
    expect(parsed.hunks).toHaveLength(2);
    const [h1, h2] = parsed.hunks;
    expect([h1.oldStart, h1.oldCount, h1.newStart, h1.newCount]).toEqual([1, 4, 1, 5]);
    expect(h1.lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ['context', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['add', undefined, 3],
      ['context', 3, 4],
      ['context', 4, 5],
    ]);
    expect(h2.header).toBe('@@ -20,3 +21,4 @@ function tail() {');
    expect(h2.lines.at(-1)).toEqual({ kind: 'context', oldNo: 22, newNo: 24, text: '' });
    expect(parsed.newEnd).toBe(24);
  });

  it('handles new files and binaries', () => {
    const added = parsePatch('--- /dev/null\n+++ b/n.md\n@@ -0,0 +1,2 @@\n+one\n+two\n');
    expect(added.hunks[0].lines.map((l) => l.newNo)).toEqual([1, 2]);
    expect(parsePatch('Binary files a/x.png and b/x.png differ\n').binary).toBe(true);
  });

  it('computes gaps and context from the working file', () => {
    const { hunks } = parsePatch(PATCH);
    const file = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const between = gapBefore(hunks, 1, file.length)!;
    expect([between.fromNew, between.toNew, between.oldOffset]).toEqual([6, 20, -1]);
    expect(contextLines(file, between, 6, 7)).toEqual([
      { kind: 'context', oldNo: 5, newNo: 6, text: 'line 6' },
      { kind: 'context', oldNo: 6, newNo: 7, text: 'line 7' },
    ]);
    expect(gapBefore(hunks, 0, file.length)).toBeNull();
    const trailing = gapBefore(hunks, 2, file.length)!;
    expect([trailing.fromNew, trailing.toNew, trailing.oldOffset]).toEqual([25, 30, -2]);
  });
});

describe('splitRows', () => {
  it('pairs deletions with the additions that follow', () => {
    const rows = splitRows(parsePatch(PATCH).hunks[0].lines);
    expect(rows.map((r) => [r.left?.kind ?? null, r.right?.kind ?? null])).toEqual([
      ['context', 'context'],
      ['del', 'add'],
      [null, 'add'],
      ['context', 'context'],
      ['context', 'context'],
    ]);
  });
});

describe('buildTree', () => {
  it('nests folders, merges single-child chains and lists folders first', () => {
    const tree = buildTree(['README.md', 'src/app/a.ts', 'src/app/b.ts', 'src/lib/only/deep.ts']);
    expect(tree.map((n) => n.name)).toEqual(['src', 'README.md']);
    const src = tree[0];
    expect(src.children.map((n) => n.name)).toEqual(['app', 'lib/only']);
    expect(src.children[1].children[0].path).toBe('src/lib/only/deep.ts');
  });

  it('filters paths case-insensitively', () => {
    expect(filterPaths(['src/App.ts', 'docs/x.md'], 'app')).toEqual(['src/App.ts']);
    expect(filterPaths(['a', 'b'], '  ')).toEqual(['a', 'b']);
  });
});
