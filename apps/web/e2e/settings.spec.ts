import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("intersection.preferences.v1", JSON.stringify({ dataSource: "mock", quality: "low" })));
});

test("saved seed and custom parameters reach a new simulation and survive a reload", async ({ page }) => {
  await page.goto("/settings?skipIntro");
  await page.getByLabel("Seed", { exact: true }).fill("0");
  await page.getByLabel("Run duration (seconds)").fill("20");
  await page.locator("summary").filter({ hasText: "Signal timing" }).click();
  await page.getByLabel("Fixed-time green (seconds)", { exact: true }).fill("12");
  await page.locator("summary").filter({ hasText: "Traffic demand" }).click();
  await page.getByLabel("North arrivals (veh/h)").fill("650");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved for new simulations" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Seed", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Save & run fixed-time", exact: true }).click();
  await expect(page.getByTestId("playback")).toHaveText("Pause");
  const actual = await page.evaluate(() => JSON.parse(localStorage.getItem("intersection.run-settings.v1")!).lastRun);
  expect(actual).toMatchObject({ seed: 0, signalTiming: { fixedGreenMs: 12000 }, scenario: { durationMs: 20000, arrivalRatesVehPerHour: { north: 650 } } });
  await page.getByRole("link", { name: "settings", exact: true }).click();
  await page.getByRole("button", { name: "Use last run · 0", exact: true }).click();
  await expect(page.getByLabel("Seed", { exact: true })).toHaveValue("0");
  await page.locator("summary").filter({ hasText: "Signal timing" }).click();
  await expect(page.getByLabel("Fixed-time green (seconds)", { exact: true })).toHaveValue("12");
});

test("invalid timing and a duration excluding scheduled events cannot be saved", async ({ page }) => {
  await page.goto("/settings?skipIntro");
  await page.getByLabel("Default scenario").selectOption("sudden-surge");
  await page.getByLabel("Run duration (seconds)").fill("10");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Duration must extend beyond every scheduled scenario event");
  await page.getByLabel("Run duration (seconds)").fill("300");
  await page.locator("summary").filter({ hasText: "Signal timing" }).click();
  await page.getByLabel("Minimum green (seconds)", { exact: true }).fill("40");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Signal timing");
  expect(await page.evaluate(() => localStorage.getItem("intersection.run-settings.v1"))).toBeNull();
});
