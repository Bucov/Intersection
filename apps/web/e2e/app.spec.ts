import { expect, test, type Page } from "@playwright/test";

/** Offline demo and low render quality: deterministic and light enough for software WebGL. */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("intersection.preferences.v1", JSON.stringify({ dataSource: "mock", quality: "low" }));
  });
});

function visible(page: Page, testId: string) {
  return page.getByTestId(testId).filter({ visible: true }).first();
}

async function openSimulation(page: Page, mode: "ai" | "traditional", scenario = "normal-traffic") {
  await page.goto(`/simulate/${mode}?skipIntro&scenario=${scenario}`);
  await expect(visible(page, "session-status")).toHaveText("Running");
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

test.describe("opening sequence", () => {
  test("plays on entry and hands the title to the header", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await expect(page.getByTestId("intro")).toBeVisible();
    await expect(page.getByTestId("intro")).toContainText("by MAGI");
    await expect(page.getByTestId("intro")).toHaveCount(0);
    await expect(page.locator("[data-wordmark-slot]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Choose how this intersection is controlled" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("can be skipped with a key press", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("intro")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("intro")).toHaveCount(0, { timeout: 3_000 });
  });

  test("respects reduced motion", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await context.addInitScript(() => {
      localStorage.setItem("intersection.preferences.v1", JSON.stringify({ dataSource: "mock", quality: "low" }));
    });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByTestId("intro")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator("[data-wordmark-slot]")).toBeVisible();
    await context.close();
  });
});

test("navigation between Home, Settings and About", async ({ page }) => {
  await page.goto("/?skipIntro");
  const nav = page.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("scene")).toHaveCSS("opacity", "0");
  await nav.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Team MAGI" })).toBeVisible();
  await nav.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "Choose how this intersection is controlled" })).toBeVisible();
});

test("the preview animates cars with no backend", async ({ page }) => {
  await page.goto("/?skipIntro");
  const scene = page.getByTestId("scene");
  await expect(scene).toHaveAttribute("data-webgl", "ok");
  await expect.poll(async () => Number(await scene.getAttribute("data-vehicles"))).toBeGreaterThan(0);
  const before = Number(await scene.getAttribute("data-sim-time"));
  await expect.poll(async () => Number(await scene.getAttribute("data-sim-time"))).toBeGreaterThan(before + 1000);
});

test("traditional mode starts from the home page", async ({ page }) => {
  await page.goto("/?skipIntro");
  await page.getByRole("button", { name: /Run traditional/ }).click();
  await expect(page).toHaveURL(/\/simulate\/traditional/);
  await expect(visible(page, "session-status")).toHaveText("Running");
  await expect(visible(page, "signal-hud")).toContainText("Fixed-time controller");
  await expect(page.getByTestId("fixed-time-panel")).toContainText("No AI is called in this mode.");
  const scene = page.getByTestId("scene");
  await expect.poll(async () => Number(await scene.getAttribute("data-vehicles"))).toBeGreaterThan(0);
});

test("AI demo mode starts, shows labeled mock agent activity and a transcript", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/?skipIntro");
  await page.getByRole("button", { name: /Run AI/ }).click();
  await expect(page).toHaveURL(/\/simulate\/ai/);
  await expect(visible(page, "session-status")).toHaveText("Running");
  await page.getByRole("combobox", { name: "Scenario" }).click();
  await page.getByRole("option", { name: /Simultaneous Proposals/ }).click();
  await expect(page).toHaveURL(/scenario=simultaneous-proposals/);
  await expect(page.getByTestId("agent-proposal-agent-a")).toContainText("green", { timeout: 60_000 });
  await expect(page.getByTestId("agent-proposal-agent-b")).toContainText("green");
  await expect(page.getByTestId("jev-panel")).toContainText("Mock");
  await expect(page.getByTestId("decision-round")).toContainText("Agent A");
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByTestId("transcript")).toContainText("Proposal");
  await expect(page.getByTestId("transcript")).toContainText("Observation ⋅ inference started");
  expect(errors).toEqual([]);
});

test("pause, resume and reset", async ({ page }) => {
  await openSimulation(page, "traditional");
  const status = visible(page, "session-status");
  const clock = visible(page, "sim-clock");
  await expect.poll(async () => (await clock.textContent()) !== "0:00").toBe(true);
  await page.getByTestId("playback").click();
  await expect(status).toHaveText("Paused");
  const paused = await clock.textContent();
  await page.waitForTimeout(2000);
  await expect(clock).toHaveText(paused ?? "");
  await page.getByTestId("playback").click();
  await expect(status).toHaveText("Running");
  await page.getByTestId("reset").click();
  await expect(status).toHaveText("Ready");
  await expect(clock).toHaveText("0:00");
  await page.getByTestId("playback").click();
  await expect(status).toHaveText("Running");
});

test("scenario selection creates a new session", async ({ page }) => {
  await openSimulation(page, "traditional");
  await page.getByRole("combobox", { name: "Scenario" }).click();
  await expect(page.getByRole("option", { name: /JEV Failure/ })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("option", { name: /Rush Hour/ }).click();
  await expect(page).toHaveURL(/scenario=rush-hour/);
  await expect(visible(page, "signal-hud")).toContainText("Rush Hour");
  await expect(visible(page, "session-status")).toHaveText("Running");
});

test("an injected ambulance appears", async ({ page }) => {
  await openSimulation(page, "ai");
  await page.getByTestId("events-menu").click();
  await page.getByRole("button", { name: "Ambulance from the north" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Scheduled: Ambulance from the north" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Transcript" }).click();
  await expect(page.getByTestId("transcript")).toContainText("Emergency vehicle entered", { timeout: 60_000 });
});

test("a paired comparison runs both controllers and reports its limits", async ({ page }) => {
  await openSimulation(page, "traditional");
  await page.getByRole("tab", { name: "Compare" }).click();
  await page.getByRole("button", { name: "Run comparison" }).click();
  const panel = page.getByTestId("comparison");
  await expect(panel).toContainText("Limitations");
  await expect(panel.getByRole("rowheader", { name: "Completed trips", exact: true })).toBeVisible();
  await expect(panel).toContainText("No Gemini or JEV calls were made");
  await expect(panel.getByText("Mock", { exact: true })).toBeVisible();
});
