import { test, expect } from '@playwright/test';

test('fresh visits use different seeds, explicit seeds replay, and paired reruns draw fresh traffic', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('intersection.preferences.v1', JSON.stringify({ dataSource: 'backend', quality: 'low' })));
  const created = () => page.waitForRequest(r => r.url().endsWith('/api/sessions') && r.method() === 'POST');
  let pending = created();
  await page.goto('/simulate/traditional?skipIntro&scenario=rush-hour');
  const first = (await pending).postDataJSON().seed;
  pending = created(); await page.reload();
  const second = (await pending).postDataJSON().seed;
  expect(second).not.toBe(first);
  pending = created(); await page.goto('/simulate/traditional?skipIntro&scenario=rush-hour&seed=42');
  expect((await pending).postDataJSON().seed).toBe(42);
  await page.getByRole('tab', { name: 'Compare', exact: true }).click();
  await page.getByRole('button', { name: '1:00', exact: true }).click();
  let comparisonRequest = page.waitForRequest(r => r.url().endsWith('/api/comparisons') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Run comparison', exact: true }).click();
  const comparisonSeed = (await comparisonRequest).postDataJSON().seed;
  await expect(page.getByRole('button', { name: 'Run again', exact: true })).toBeVisible();
  comparisonRequest = page.waitForRequest(r => r.url().endsWith('/api/comparisons') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Run again', exact: true }).click();
  expect((await comparisonRequest).postDataJSON().seed).not.toBe(comparisonSeed);
});
