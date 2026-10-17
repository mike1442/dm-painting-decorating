import { defineConfig, devices } from "@playwright/test";
import { liveEnvironment } from "./tests/live/support/live-environment";

// This is intentionally separate from the anonymous, credential-free CI suite.
// Fail before launching a browser if the real-workflow prerequisites are absent.
const { baseURL, isLoopback } = liveEnvironment();

export default defineConfig({
  testDir: "./tests/live",
  testMatch: "full-workflow.spec.ts",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results/live",
  use: {
    baseURL,
    // Traces can capture passwords, session cookies, and private customer URLs.
    trace: "off",
    screenshot: "off",
    video: "off",
    serviceWorkers: "block",
  },
  projects: [
    { name: "live-desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "live-mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: isLoopback ? {
    command: "npm run start -- --hostname 127.0.0.1",
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  } : undefined,
});
