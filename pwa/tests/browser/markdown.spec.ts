import { expect, test } from '@playwright/test';

const longPath = '~/dev/example-project/worktrees/' + 'long-branch-name-'.repeat(12);
const table = `| Chemin | Branche | Rôle |\n|:---|:---:|---:|\n| \`${longPath}\` | \`main\` | Actuel |\n| \`~/worktree\` | \`fix/bug\` | Correction |`;
const reply = `# Worktrees\n\n${table}\n\n### Détails\n\n1. Premier\n   - Enfant\n2. Second\n\n> *Citation* et ~~barré~~\n\n- [x] Vérifié\n\n[Documentation](https://example.com)\n\n\`${longPath}\`\n\n\`\`\`ts\nconst path = "${longPath}";\n<script>alert(1)</script>\n\`\`\``;

test('renders streaming, settled and reloaded replies without page overflow', async ({ page }, testInfo) => {
  let saved = false;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/tasks/markdown', (route) => route.fulfill({
    json: {
      id: 'markdown', repo: 'test', title: 'Markdown', state: 'done',
      created_at: Date.now(), touched_files: [],
      turns: saved ? [{ role: 'agent', text: reply, status: 'settled', files: [], at: Date.now() }] : [],
    },
  }));
  await Promise.all([
    page.waitForResponse('**/api/tasks/markdown'),
    page.goto(`/tests/browser/fixture/?variant=${testInfo.project.name}`),
  ]);
  await page.getByRole('button', { name: 'Start', exact: true }).click();

  // Cut through the table delimiter, link destination and final code fence.
  const cuts = [reply.indexOf('|:---') + 3, reply.indexOf('https://') + 10, reply.length - 2, reply.length];
  let offset = 0;
  for (const end of cuts) {
    await page.getByRole('textbox', { name: 'Delta' }).fill(reply.slice(offset, end));
    await page.getByRole('button', { name: 'Append', exact: true }).click();
    offset = end;
    await expect(page.locator('.markdown h1')).toHaveText('Worktrees');
    await expect(page.locator('.markdown script')).toHaveCount(0);
  }

  const markdown = page.locator('.markdown');
  await expect(markdown.locator('tbody tr')).toHaveCount(2);
  await expect(markdown.locator('ol > li > ul > li')).toHaveText('Enfant');
  await expect(markdown.locator('input')).toBeDisabled();
  await expect(markdown.locator('pre code')).toContainText('<script>alert(1)</script>');
  await expect(markdown.locator('a')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(markdown.locator('th').nth(1)).toHaveCSS('text-align', /^(?:-webkit-)?center$/);
  await expect(markdown.locator('th').nth(2)).toHaveCSS('text-align', /^(?:-webkit-)?right$/);
  await expect(markdown.locator('pre code')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

  const streamingHtml = await markdown.innerHTML();
  saved = true;
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('.working')).toHaveCount(0);
  await expect(markdown).toHaveCount(1);
  expect(await markdown.innerHTML()).toBe(streamingHtml);
  await page.reload();
  await expect(markdown.locator('tbody tr')).toHaveCount(2);
  expect(await markdown.innerHTML()).toBe(streamingHtml);

  const widths = await page.evaluate(() => {
    const thread = document.querySelector('.thread')!;
    const table = document.querySelector('.table-scroll')!;
    const pre = document.querySelector('pre')!;
    return {
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
      threadFits: thread.scrollWidth <= thread.clientWidth,
      tableScrolls: table.scrollWidth > table.clientWidth,
      codeScrolls: pre.scrollWidth > pre.clientWidth,
    };
  });
  expect(widths).toEqual({ pageFits: true, threadFits: true, tableScrolls: true, codeScrolls: true });
  await markdown.locator('.table-scroll').focus();
  await expect(markdown.locator('.table-scroll')).toBeFocused();
  const screenshot = testInfo.outputPath('markdown.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('markdown', { path: screenshot, contentType: 'image/png' });
  expect(errors).toEqual([]);
});
