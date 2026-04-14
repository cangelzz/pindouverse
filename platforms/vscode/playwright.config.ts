import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    browserName: "chromium",
    viewport: { width: 1200, height: 800 },
  },
  projects: [
    {
      name: "webview",
      testMatch: /webview\.integration\.test\.ts/,
    },
  ],
});
