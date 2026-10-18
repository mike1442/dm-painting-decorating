import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:3000";
// The locally started server has the ChatGPT connection switched on (with a
// throwaway secret) so its anonymous boundaries are exercised, not just "off".
if (!process.env.E2E_BASE_URL) process.env.DM_CHATGPT_SECRET ||= randomBytes(32).toString("base64url");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run start -- --hostname 127.0.0.1",
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
