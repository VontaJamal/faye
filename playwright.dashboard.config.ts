import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/dashboard",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    trace: "on-first-retry"
  },
  webServer: {
    command: "node ./scripts/test/dashboard-static-server.mjs --port 4173",
    url: "http://127.0.0.1:4173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
