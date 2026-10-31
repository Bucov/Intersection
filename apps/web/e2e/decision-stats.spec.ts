import { test, expect } from '@playwright/test';

test('Statistics pauses the run, draws it in squares and keeps the breakdown across tabs', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('intersection.preferences.v1', JSON.stringify({ dataSource: 'mock', quality: 'low' })));
  await page.goto('/simulate/ai?skipIntro&scenario=simultaneous-proposals');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('tab', { name: 'Statistics', exact: true }).click();
  // Opening Statistics holds the run still.
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByTestId('stats-board')).toBeVisible();
  await expect(page.getByRole('img', { name: /^North\/South: \d+ s$/ }).first()).toBeVisible();
  await page.getByText('Full breakdown').click();
  await expect(page.getByRole('heading', { name: 'Decision sources' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText('1 accepted decisions from the three sources', { exact: false })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const sources = await page.getByRole('img', { name: /Deterministic fallback:/ }).first().getAttribute('aria-label');
  await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
  await page.getByRole('tab', { name: 'Statistics', exact: true }).click();
  await page.getByText('Full breakdown').click();
  await expect(page.getByRole('img', { name: /Deterministic fallback:/ }).first()).toHaveAttribute('aria-label', sources!);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Decision sources' }).scrollIntoViewIfNeeded();
});
