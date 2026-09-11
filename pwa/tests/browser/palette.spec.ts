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
  await expect(page.getByRole('option', { name: /Build machine/ })).toContainText('Current machine');
});

test('visible trigger, navigation, empty state and focus restoration', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.getByRole('button', { name: /^Working/ }).click();
  const trigger = page.getByRole('button', { name: /Search discussions (and|&) machines/ });
  await trigger.click();
  const search = page.getByRole('combobox');
  await expect(search).toBeFocused();
  await expect(page.getByRole('option', { name: /Réparer/ })).toBeVisible();
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
