import { defineConfig } from "vitest/config";

// Root `npm test` runs every workspace suite with its own configuration.
// The shared package has no config file and keeps Vitest defaults.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "shared", root: "./packages/shared", include: ["test/**/*.test.ts"] } },
      "./apps/web/vitest.config.ts",
      { test: { name: "server", root: "./apps/server", include: ["test/**/*.test.ts"] } },
    ],
  },
});
