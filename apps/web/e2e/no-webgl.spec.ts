import { expect, test } from "@playwright/test";

/** A browser where WebGL context creation fails, as on machines with it disabled or blocklisted. */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem("intersection.preferences.v1", JSON.stringify({ dataSource: "mock", quality: "low" }));
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") return null;
      return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
});

test("the app loads and runs on the 2D schematic when WebGL fails", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/?skipIntro");
  await expect(page.getByTestId("scene")).toHaveAttribute("data-webgl", "unavailable");
  await expect(page.getByText(/3D view unavailable/)).toBeVisible();
  await expect(page.getByTestId("scene-fallback").locator("rect[transform]").first()).toBeAttached();
  await page.getByRole("button", { name: /Run AI/ }).click();
  await expect(page.getByTestId("session-status").filter({ visible: true }).first()).toHaveText("Running");
  expect(errors).toEqual([]);
});
