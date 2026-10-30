import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureMozaikCloud } from "../src/ai/cloud.js";
beforeEach(() => vi.stubEnv("MOZAIK_CREDENTIALS_FILE", "/nonexistent/credentials.json"));
afterEach(() => vi.unstubAllEnvs());
it("keeps Mozaik cloud off unless explicitly enabled", () => {
  const env: NodeJS.ProcessEnv = { MOZAIK_API_KEY: "pk_test" };
  expect(configureMozaikCloud(env).enabled).toBe(false);
  expect(env.MOZAIK_API_KEY).toBe("");
});
it("stays off when enabled without a key", () => {
  const env: NodeJS.ProcessEnv = { MOZAIK_CLOUD: "on", MOZAIK_API_KEY: " " };
  const status = configureMozaikCloud(env);
  expect(status.enabled).toBe(false);
  expect(status.message).toMatch(/no key found/);
  expect(env.MOZAIK_API_KEY).toBe("");
});
it("pins the resolved key when enabled", () => {
  const env: NodeJS.ProcessEnv = { MOZAIK_CLOUD: "on", MOZAIK_PROJECT_KEY: "pk_legacy" };
  expect(configureMozaikCloud(env).enabled).toBe(true);
  expect(env.MOZAIK_API_KEY).toBe("pk_legacy");
});
