import { defineConfig, devices } from "@playwright/test";

/**
 * The QA harness.
 *
 * It runs against a dev server started with **dummy** Supabase values, so no
 * request in this suite ever reaches the real project: every `/auth/v1/*` and
 * `/rest/v1/*` call is answered by the route interception in `e2e/support/mocks.mjs`.
 *
 * The chromium project pins `channel: "chrome"` — the browser already on the
 * machine, so the suite needs no downloaded browser to run. Firefox and WebKit
 * use Playwright's own builds and are only usable after `npx playwright install
 * firefox webkit`; see docs/QA_REPORT.md for which engines the reported results
 * actually cover.
 */
const PORT = Number(process.env.QA_PORT ?? 5200);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    colorScheme: "light",
    // A stable locale keeps Intl-formatted dates from depending on the machine.
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    // `--host 127.0.0.1` on purpose: Vite's default binds IPv6 `::1` only, and
    // the readiness probe and the tests both speak IPv4.
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: "https://qa-fixture.supabase.co",
      VITE_SUPABASE_ANON_KEY: "qa-anon-key-not-a-real-credential",
    },
  },
});
