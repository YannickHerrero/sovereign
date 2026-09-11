import { expect, test, type Page } from '@playwright/test';

async function command(page: Page, query: string) {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill(query);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

const tasks = [
  { id: 'one', title: 'Réparer le Composer', repo: 'sovereign', updated_at: 20 },
  { id: 'two', title: 'Deployment notes', repo: 'infra', updated_at: 10 },
].map((task) => ({ ...task, agent: 'pi', state: 'done', pinned: false, unread: false, plus: 0, minus: 0, created_at: 1 }));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => !localStorage.getItem('sovereign.settings.v1') && localStorage.setItem('sovereign.settings.v1', JSON.stringify({
    servers: [
      { id: 'local', name: 'Laptop', url: 'http://127.0.0.1:4174/local', token: '' },
      { id: 'remote', name: 'Build machine', url: 'http://127.0.0.1:4174/remote', token: '' },
    ], openaiKey: '',
  })));
  const savedTasks = structuredClone(tasks);
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path.endsWith('/workspace')) json = { name: 'Test', agents: ['pi'], agents_running: 0 };
    if (path.endsWith('/models')) json = { models: [], current: null };
    if (path.endsWith('/tasks')) json = path.startsWith('/local') ? savedTasks : [];
    if (path.endsWith('/diff')) json = { files: [] };
    const task = savedTasks.find((t) => path.endsWith(`/tasks/${t.id}`));
    if (task) {
      if (route.request().method() === 'PATCH') Object.assign(task, route.request().postDataJSON());
      json = { ...task, turns: [], touched_files: [], queued: [] };
    }
    return route.fulfill({ json });
  });
  await page.goto('/w/local/t/one');
});

test('fuzzy search opens discussions and switches hosts with the keyboard', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search discussions and machines' });
  await expect(search).toBeFocused();
  await search.fill('dplmnt');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/w\/local\/t\/two$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.keyboard.press('Meta+k');
  await search.fill('bld');
  await expect(page.getByRole('option')).toContainText('Build machine');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/w\/remote$/);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('option', { name: /Réparer|Deployment/ })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /^Build machine/ })).toContainText('Current machine');
});

test('visible trigger, navigation, empty state and focus restoration', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.getByRole('button', { name: /^Working/ }).click();
  const trigger = page.getByRole('button', { name: /Search discussions (and|&) machines/ });
  await trigger.click();
  const search = page.getByRole('combobox');
  await expect(search).toBeFocused();
  await expect(page.getByRole('option', { name: /^Réparer/ })).toBeVisible();
  await expect(page.getByRole('option', { selected: true })).toContainText('View diff');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toContainText('Pin discussion');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('option', { selected: true })).toContainText('View diff');
  await search.fill('zzzzzz');
  await expect(page.getByText('No results', { exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('unavailable hosts do not prevent switching machines', async ({ page }) => {
  await page.route('**/local/api/tasks', (route) => route.fulfill({ status: 503, json: { error: 'Host unavailable' } }));
  await page.reload();
  await page.keyboard.press('Control+k');
  await expect(page.getByText(/Could not refresh discussions/)).toBeVisible();
  await page.getByRole('combobox').fill('bld');
  await page.getByRole('option', { name: /Build machine/ }).click();
  await expect(page).toHaveURL(/\/w\/remote$/);
});

test('contextual diff navigation preserves drafts and Escape only dismisses the palette', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Follow up…', exact: true }).click();
  await page.locator('textarea').fill('Draft before diff');
  await command(page, 'diff');
  await expect(page).toHaveURL(/\/w\/local\/t\/one\/diff$/);
  await expect(page.getByText(/No changes/)).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('option', { name: /Back to conversation/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /View diff|width/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/diff$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await command(page, 'conversation');
  await expect(page).toHaveURL(/\/w\/local\/t\/one$/);
  if (testInfo.project.name === 'mobile' && !await page.locator('textarea').isVisible()) {
    await page.getByRole('button', { name: 'Draft before diff', exact: true }).click();
  }
  await expect(page.locator('textarea')).toHaveValue('Draft before diff');
});

test('desktop display actions apply immediately and persist', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop layout options');
  await command(page, 'pleine largeur');
  await expect(page.locator('.thread')).toHaveClass(/wide/);
  await page.reload();
  await expect(page.locator('.thread')).toHaveClass(/wide/);
  await command(page, 'standard width');
  await expect(page.locator('.thread')).not.toHaveClass(/wide/);
  await command(page, 'masquer');
  await expect(page.locator('.sidebar')).toHaveClass(/collapsed/);
  await command(page, 'afficher');
  await expect(page.locator('.sidebar')).not.toHaveClass(/collapsed/);
  await command(page, 'diff');
  await command(page, 'split');
  await expect(page.getByRole('radio', { name: 'Split', exact: true })).toBeChecked();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Split', exact: true })).toBeChecked();
  await command(page, 'unifié');
  await expect(page.getByRole('radio', { name: 'Unified', exact: true })).toBeChecked();
});

test('pin commands reflect server state and report failures', async ({ page }) => {
  await command(page, 'épingler');
  await expect(page.getByRole('status')).toContainText('Discussion pinned');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('option', { name: /Unpin discussion/ })).toBeVisible();
  await page.getByRole('combobox').fill('désépingler');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Discussion unpinned');
  await page.route('**/api/tasks/one', (route) => route.fulfill({ status: 503, json: { error: 'Cannot pin now' } }));
  await command(page, 'épingler');
  await expect(page.getByRole('status')).toContainText('Cannot pin now');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('option', { name: /^Pin discussion/ })).toBeVisible();
});

test('copy links always target the conversation and clipboard errors are visible', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { document.documentElement.dataset.copied = text; },
    } });
  });
  await command(page, 'diff');
  await command(page, 'copier le lien');
  await expect(page.getByRole('status')).toContainText('Discussion link copied');
  await expect(page.locator('html')).toHaveAttribute('data-copied', 'http://127.0.0.1:4174/w/local/t/one');
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { throw new Error('Clipboard denied'); },
    } });
  });
  await command(page, 'copy link');
  await expect(page.getByRole('status')).toContainText('Clipboard denied');
});

test('new discussion opens the composer and settings works without a host', async ({ page }, testInfo) => {
  await command(page, 'nouvelle discussion');
  await expect(page).toHaveURL(/\/w\/local\/new$/);
  await expect(page.locator('textarea')).toBeVisible();
  await expect(page.locator('textarea')).toBeFocused();
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await command(page, 'nouvelle discussion');
    await expect(page.locator('textarea')).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('option', { name: /width|sidebar|split|unified/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
  await page.evaluate(() => localStorage.setItem('sovereign.settings.v1', JSON.stringify({ servers: [], openaiKey: '' })));
  await page.goto('/');
  await command(page, 'réglages');
  await expect(page).toHaveURL(/\/settings$/);
});

test('desktop trigger lives in the current pane header, never the sidebar', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop header placement');
  const trigger = page.getByRole('button', { name: 'Search discussions and machines', exact: true });
  for (const path of ['/w/local/t/one', '/w/local/new', '/w/local/t/one/diff', '/settings']) {
    await page.goto(path);
    await expect(trigger).toHaveCount(1);
    await expect(trigger).toBeVisible();
    await expect(page.locator('.sidebar').getByRole('button', { name: 'Search discussions and machines' })).toHaveCount(0);
    expect(await trigger.evaluate((el) => Boolean(el.closest('.head, header')))).toBe(true);
    await trigger.click();
    await expect(page.getByRole('combobox', { name: 'Search discussions and machines' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await page.goto('/w/local/t/one');
  await page.getByRole('button', { name: 'Collapse workspaces sidebar' }).click();
  await expect(trigger).toBeVisible();
  const screenshot = testInfo.outputPath('command-center-header.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('command-center-header', { path: screenshot, contentType: 'image/png' });
  await trigger.click();
  await expect(page.getByRole('combobox')).toBeFocused();
});

test('compact palette design stays within the viewport and keeps long rows on one line', async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await expect(page.locator('.result-count')).toHaveText(testInfo.project.name === 'desktop' ? '11 results' : '9 results');
  await expect(dialog).toHaveCSS('background-color', 'rgb(251, 250, 248)');
  await expect(dialog).toHaveCSS('border-radius', '12px');
  await expect(dialog.locator('.status')).toHaveCount(0);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.height).toBeLessThanOrEqual(452);
  if (testInfo.project.name === 'desktop') {
    expect(bounds!.width).toBe(540);
    expect(bounds!.y).toBe(84);
  }
  const screenshot = testInfo.outputPath('command-center.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('command-center', { path: screenshot, contentType: 'image/png' });

  await page.getByRole('combobox').fill('dplmnt');
  await expect(page.locator('.result-count')).toHaveText('1 result');
  await page.getByRole('combobox').fill('zzzzzz');
  await expect(page.locator('.result-count')).toHaveText('0 results');
  await expect(page.getByText('No results', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  const longTask = { ...tasks[0], title: 'A very long discussion title '.repeat(12), repo: 'very-long-project-name-'.repeat(12) };
  await page.route('**/local/api/tasks', (route) => route.fulfill({ json: [longTask] }));
  await page.reload();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('very long discussion');
  const row = page.getByRole('option');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('title', `${longTask.title} · ${longTask.repo} · done`);
  const dimensions = await row.evaluate((el) => {
    const title = el.querySelector('.row-title')!;
    const meta = el.querySelector('.row-meta')!;
    return {
      titleTruncated: title.scrollWidth > title.clientWidth,
      metaTruncated: meta.scrollWidth > meta.clientWidth,
      sameLine: Math.abs(title.getBoundingClientRect().y + title.clientHeight / 2 - meta.getBoundingClientRect().y - meta.clientHeight / 2) < 1,
      fits: el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  expect(dimensions).toEqual({ titleTruncated: true, metaTruncated: true, sameLine: true, fits: true });
  // Narrow phones and a short viewport (e.g. an on-screen keyboard) retain the footer.
  await page.setViewportSize({ width: 320, height: 360 });
  await expect(dialog.locator('.help')).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('palette typing leaves the composer draft untouched', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Follow up…', exact: true }).click();
  const composer = page.locator('textarea');
  await composer.fill('Unsent draft');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('REPARER');
  await expect(page.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('Unsent draft');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('dplmnt');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('cmps');
  await page.keyboard.press('Enter');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Unsent draft', exact: true }).click();
  await expect(composer).toHaveValue('Unsent draft');
});
