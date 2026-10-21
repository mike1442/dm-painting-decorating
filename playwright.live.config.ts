import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { liveEnvironment } from "./tests/live/support/live-environment";

// This is intentionally separate from the anonymous, credential-free CI suite.
// Fail before launching a browser if the real-workflow prerequisites are absent.
const { baseURL } = liveEnvironment();
// The local server under test seals ChatGPT tokens with a fresh random secret
// for each run; it never needs or sees the deployment's own secret.
process.env.DM_CHATGPT_SECRET ||= randomBytes(32).toString("base64url");

export default defineConfig({
  testDir: "./tests/live",
  testMatch: ["chatgpt-connection.spec.ts", "custom-gpt.spec.ts", "full-workflow.spec.ts", "quick-quote.spec.ts"],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  // Each step is a focused test. Bounded actions fail within seconds with the
  // page state instead of exhausting a long test budget; sessions and TEST
  // records are cleaned up by worker fixtures with their own time budget.
  timeout: 60_000,
  // Hosted Supabase Auth occasionally leaves a request unanswered for ~10 s
  // (a read and its retry); the app then repeats the load or save by itself
  // after 3 s. A state that waits on cloud storage must outlast that cycle.
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results/live",
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
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
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1",
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
