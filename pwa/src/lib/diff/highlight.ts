/**
 * Syntax highlighting for diff lines. highlight.js core is loaded on first use and each
 * grammar on demand, so the main bundle stays free of them. Lines are highlighted one at a
 * time: multi-line constructs (block comments) may lose color across lines, which is the
 * usual trade-off for diff views.
 */

import type { HLJSApi, LanguageFn } from 'highlight.js';

const EXTENSIONS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  svelte: 'xml', vue: 'xml', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml',
  css: 'css', scss: 'scss',
  json: 'json', jsonc: 'json', webmanifest: 'json',
  md: 'markdown', markdown: 'markdown',
  rs: 'rust', py: 'python', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', rb: 'ruby', php: 'php', dart: 'dart',
  sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  dockerfile: 'dockerfile', diff: 'diff', patch: 'diff',
};

const FILENAMES: Record<string, string> = { dockerfile: 'dockerfile' };

// Explicit imports so the bundler emits one lazy chunk per grammar we actually offer,
// instead of one for each of highlight.js's 190 languages.
const GRAMMARS: Record<string, () => Promise<{ default: LanguageFn }>> = {
  typescript: () => import('highlight.js/lib/languages/typescript'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  json: () => import('highlight.js/lib/languages/json'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  rust: () => import('highlight.js/lib/languages/rust'),
  python: () => import('highlight.js/lib/languages/python'),
  go: () => import('highlight.js/lib/languages/go'),
  java: () => import('highlight.js/lib/languages/java'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  swift: () => import('highlight.js/lib/languages/swift'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  php: () => import('highlight.js/lib/languages/php'),
  dart: () => import('highlight.js/lib/languages/dart'),
  bash: () => import('highlight.js/lib/languages/bash'),
  sql: () => import('highlight.js/lib/languages/sql'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  diff: () => import('highlight.js/lib/languages/diff'),
};

/** highlight.js language name for a path, or null when nothing sensible applies. */
export function languageFor(path: string): string | null {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (FILENAMES[name]) return FILENAMES[name];
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  return EXTENSIONS[ext] ?? null;
}

export interface LineHighlighter {
  /** Returns safe HTML for one line of code. */
  line(text: string): string;
}

let core: Promise<HLJSApi> | null = null;
const loaded = new Map<string, Promise<LineHighlighter | null>>();

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const plain: LineHighlighter = { line: escape };

/** Loads the grammar for `language`; resolves null when it is unknown or fails to load. */
export function highlighterFor(language: string | null): Promise<LineHighlighter | null> {
  if (!language) return Promise.resolve(null);
  let pending = loaded.get(language);
  if (!pending) {
    pending = load(language).catch(() => null);
    loaded.set(language, pending);
  }
  return pending;
}

async function load(language: string): Promise<LineHighlighter | null> {
  core ??= import('highlight.js/lib/core').then((m) => m.default);
  const hljs = await core;
  const grammar = GRAMMARS[language];
  if (!grammar) return null;
  if (!hljs.getLanguage(language)) {
    hljs.registerLanguage(language, (await grammar()).default);
  }
  return {
    line(text) {
      if (!text) return '';
      try {
        return hljs.highlight(text, { language, ignoreIllegals: true }).value;
      } catch {
        return escape(text);
      }
    },
  };
}
