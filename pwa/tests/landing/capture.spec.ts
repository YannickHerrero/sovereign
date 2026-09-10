/// <reference types="node" />
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mockProduct } from './mock';

const output = fileURLToPath(new URL('../../../landing/public/screenshots/', import.meta.url));

async function capture(page: Page, name: string, region?: Locator) {
  await page.evaluate(() => document.fonts.ready);
  await mkdir(output, { recursive: true });
  const options = { path: `${output}${name}.png`, animations: 'disabled' as const, caret: 'hide' as const };
  if (region) await region.screenshot(options);
  else await page.screenshot(options);
}

test('capture the real desktop conversation and diff', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  const unexpected = await mockProduct(page);
  await page.goto('/w/macbook/t/dark-mode');
  await expect(page.locator('.markdown')).toContainText('8 tests passent');
  await expect(page.locator('.sidebar')).toContainText('Offline');
  await page.getByRole('radio', { name: 'Project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New task in design-system', exact: true })).toBeVisible();
  await capture(page, 'desktop-conversation');

  // Use the actual navigation and lazy diff API, not a standalone component fixture.
  await page.getByRole('button', { name: /View diff/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Diff layout' })).toBeVisible();
  await expect(page.locator('.blocks')).toContainText('getTheme');
  await expect(page.locator('.blocks .placeholder')).toHaveCount(0);
  await capture(page, 'desktop-diff', page.locator('.view'));
  expect(unexpected).toEqual([]);
});

test('capture the real mobile conversation and workspace list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const unexpected = await mockProduct(page);
  await page.goto('/w/macbook/t/dark-mode');
  await expect(page.locator('.markdown')).toContainText('8 tests passent');
  await capture(page, 'mobile-conversation');

  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto('/');
  await expect(page.getByText('Choose a machine to work on')).toBeVisible();
  await expect(page.getByText('Online', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Offline', { exact: true })).toBeVisible();
  await capture(page, 'mobile-workspaces');
  expect(unexpected).toEqual([]);
});
