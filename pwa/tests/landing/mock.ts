import type { Page } from '@playwright/test';
import type { FileDiff, TaskDetail, TaskSummary, Workspace } from '../../src/lib/types';

export const now = Date.parse('2026-09-10T09:41:00+02:00');
const minute = 60_000;

const themePatch = `diff --git a/src/lib/theme.ts b/src/lib/theme.ts
index 3a19b21..7f30c42 100644
--- a/src/lib/theme.ts
+++ b/src/lib/theme.ts
@@ -1,3 +1,17 @@
 export type Theme = 'light' | 'dark';
 
-export const theme: Theme = 'light';
+export function getTheme(): Theme {
+  const saved = localStorage.getItem('theme');
+  if (saved === 'light' || saved === 'dark') {
+    return saved;
+  }
+
+  return matchMedia('(prefers-color-scheme: dark)').matches
+    ? 'dark'
+    : 'light';
+}
+
+export function setTheme(theme: Theme) {
+  document.documentElement.dataset.theme = theme;
+  localStorage.setItem('theme', theme);
+}
`;

export const files: FileDiff[] = [
  { path: 'src/lib/theme.ts', plus: 15, minus: 1, patch: themePatch },
  {
    path: 'src/styles.css', plus: 5, minus: 0,
    patch: `diff --git a/src/styles.css b/src/styles.css
index a190baa..fe28cca 100644
--- a/src/styles.css
+++ b/src/styles.css
@@ -1,3 +1,8 @@
 :root {
   color-scheme: light dark;
 }
+
+:root[data-theme='dark'] {
+  --background: #161819;
+  --foreground: #f4f3ee;
+}
`,
  },
  {
    path: 'tests/theme.test.ts', plus: 8, minus: 0,
    patch: `diff --git a/tests/theme.test.ts b/tests/theme.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/theme.test.ts
@@ -0,0 +1,8 @@
+import { expect, test } from 'vitest';
+import { getTheme, setTheme } from '../src/lib/theme';
+
+test('persists the selected theme', () => {
+  setTheme('dark');
+  expect(getTheme()).toBe('dark');
+  expect(localStorage.getItem('theme')).toBe('dark');
+});
`,
  },
];

export const task: TaskDetail = {
  id: 'dark-mode', agent: 'pi', repo: 'storefront',
  title: 'Ajouter le mode sombre', pinned: true, state: 'done',
  plus: 28, minus: 1, created_at: now - 18 * minute, updated_at: now - 2 * minute,
  model: 'claude-sonnet-4-5', branch: 'feat/dark-mode',
  touched_files: files.map(({ path, plus, minus }) => ({ path, plus, minus })),
  turns: [
    { role: 'user', text: 'Ajoute un mode sombre qui suit les préférences système et mémorise mon choix.', at: now - 18 * minute },
    {
      role: 'agent', status: 'settled', at: now - 2 * minute,
      text: `Le mode sombre est prêt.\n\n### Un thème qui suit vos préférences\n\n- Détection automatique du thème système.\n- Choix sauvegardé pour la prochaine visite.\n- Couleurs adaptées, sans modifier la mise en page.\n\nLes **8 tests passent**, y compris la persistance du thème. Vous pouvez relire les changements dans le diff.`,
      files: files.map((file) => file.path),
    },
  ],
};

export const tasks: TaskSummary[] = [
  task,
  { ...task, id: 'navigation', title: 'Fluidifier la navigation mobile', agent: 'claude', pinned: false, plus: 42, minus: 12, updated_at: now - 32 * minute },
  { ...task, id: 'checkout', title: 'Simplifier le parcours de commande', pinned: false, state: 'working', plus: 18, minus: 4, updated_at: now - minute },
  { ...task, id: 'tokens', repo: 'design-system', title: 'Harmoniser les espacements', pinned: false, plus: 36, minus: 18, updated_at: now - 60 * minute },
  { ...task, id: 'buttons', repo: 'design-system', title: 'Documenter les composants', agent: 'claude', pinned: false, plus: 64, minus: 0, updated_at: now - 120 * minute },
];

/** The real app talks only to these intercepted demo hosts, never to a server or agent. */
export async function mockProduct(page: Page) {
  const unexpected: string[] = [];
  await page.clock.setFixedTime(now);
  await page.addInitScript(({ now }) => {
    localStorage.setItem('sovereign.settings.v1', JSON.stringify({
      openaiKey: '',
      servers: [
        { id: 'macbook', name: 'MacBook Pro', url: 'https://macbook.demo.invalid', token: 'demo-not-a-secret', lastSeen: now },
        { id: 'server', name: 'Serveur maison', url: 'https://server.demo.invalid', token: 'demo-not-a-secret', lastSeen: now },
        { id: 'studio', name: 'Station de travail', url: 'https://studio.demo.invalid', token: 'demo-not-a-secret', lastSeen: now - 7_200_000 },
      ],
    }));
  }, { now });
  await page.routeWebSocket(/\/api\/ws\?/, () => {
    // Keep the feed open but idle; the captured task is already settled.
  });
  // Fail closed if the UI starts requesting any unmocked remote service.
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === 'http://127.0.0.1:4175') return route.continue();
    unexpected.push(`Unmocked request: ${route.request().url()}`);
    return route.abort();
  });
  await page.route('https://*.demo.invalid/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() !== 'GET') {
      unexpected.push(`${route.request().method()} ${url}`);
      return route.abort();
    }
    if (path === '/api/workspace') {
      if (url.hostname.startsWith('studio.')) return route.fulfill({ status: 503, json: { error: 'Demo machine offline' } });
      const workspace: Workspace = {
        name: url.hostname.startsWith('macbook.') ? 'MacBook Pro' : 'Serveur maison',
        version: '0.1.0', uptime_secs: 86400, agents_running: url.hostname.startsWith('macbook.') ? 1 : 2,
        agents: ['pi', 'claude'],
      };
      return route.fulfill({ json: workspace });
    }
    if (path === '/api/tasks') return route.fulfill({ json: tasks });
    if (path === '/api/tasks/dark-mode') return route.fulfill({ json: task });
    if (path === '/api/tasks/dark-mode/diff') {
      const selected = url.searchParams.get('path');
      const result = selected ? files.filter((file) => file.path === selected) : files;
      return route.fulfill({ json: { files: url.searchParams.has('summary') ? result.map((file) => ({ ...file, patch: '' })) : result } });
    }
    unexpected.push(`${route.request().method()} ${url}`);
    return route.abort();
  });
  page.on('pageerror', (error) => unexpected.push(error.message));
  return unexpected;
}
