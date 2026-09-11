import { expect, test } from '@playwright/test';

const tasks = [
  { id: 'one', title: 'Réparer le Composer', repo: 'sovereign', updated_at: 20 },
  { id: 'two', title: 'Deployment notes', repo: 'infra', updated_at: 10 },
].map((task) => ({ ...task, agent: 'pi', state: 'done', pinned: false, unread: false, plus: 0, minus: 0, created_at: 1 }));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('sovereign.settings.v1', JSON.stringify({
    servers: [
      { id: 'local', name: 'Laptop', url: 'http://127.0.0.1:4174/local', token: '' },
      { id: 'remote', name: 'Build machine', url: 'http://127.0.0.1:4174/remote', token: '' },
    ], openaiKey: '',
  })));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path.endsWith('/workspace')) json = { name: 'Test', agents: ['pi'], agents_running: 0 };
    if (path.endsWith('/models')) json = { models: [], current: null };
    if (path.endsWith('/tasks')) json = path.startsWith('/local') ? tasks : [];
    const task = tasks.find((t) => path.endsWith(`/tasks/${t.id}`));
    if (task) json = { ...task, turns: [], touched_files: [], queued: [] };
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
  await expect(page.getByRole('group', { name: 'Discussions', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: /Build machine/ })).toContainText('Current machine');
});

test('visible trigger, navigation, empty state and focus restoration', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'desktop') await page.getByRole('button', { name: /^Working/ }).click();
  const trigger = page.getByRole('button', { name: /Search discussions (and|&) machines/ });
  await trigger.click();
  const search = page.getByRole('combobox');
  await expect(search).toBeFocused();
  await expect(page.getByRole('option')).toHaveCount(4);
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { selected: true })).toContainText('Deployment notes');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('option', { selected: true })).toContainText('Réparer');
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
