import { test, expect } from '@playwright/test';

test('offline Decision Stats survives tab navigation at desktop and mobile sizes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('intersection.preferences.v1', JSON.stringify({ dataSource: 'mock', quality: 'low' })));
  await page.goto('/simulate/ai?skipIntro&scenario=simultaneous-proposals');
  await page.getByRole('tab', { name: 'Decision Stats', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decision sources' })).toBeVisible();
  await expect(page.getByText('1 accepted decisions from the three sources', { exact: false })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const sources = await page.getByRole('img', { name: /Deterministic fallback:/ }).getAttribute('aria-label');
  await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
  await page.getByRole('tab', { name: 'Decision Stats', exact: true }).click();
  await expect(page.getByRole('img', { name: /Deterministic fallback:/ })).toHaveAttribute('aria-label', sources!);
  await page.screenshot({ path: '/tmp/decision-stats-verified-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Decision sources' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/decision-stats-verified-mobile.png' });
});
