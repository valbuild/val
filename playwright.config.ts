import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests for the Val Studio.
 *
 * These exist because of what the unit tests could not see. Removing
 * `ValSyncEngine` means the store system becomes the only thing between a
 * keystroke and the server, and the two most expensive bugs in that migration
 * were both invisible to 1842 passing tests: a `StrictMode` effect cleanup that
 * disposed the whole store graph, and four AI write paths that applied edits
 * locally and saved nothing. Both needed a real browser, a real server, and a
 * real project.
 *
 * ## Two servers, and why
 *
 * The Studio is a SPA served by Vite in dev; the app and its `/api/val` routes
 * are Next. Neither alone is the thing users run. So both start, and the tests
 * drive the app's `/val` route the way an editor would.
 *
 * `reuseExistingServer` so a developer with servers already up does not wait for
 * two more, and so a failing test can be re-run against the same processes.
 */
export default defineConfig({
  testDir: "./e2e",
  // One at a time. These tests write patches to the same `.val` directory on
  // disk, so parallel workers would be editing each other's content — and the
  // failure would look like a bug in the store rather than in the harness.
  workers: 1,
  fullyParallel: false,
  // A generous timeout, and not because the app is slow: `next dev` compiles the
  // route on first request, so the first test pays for a build.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3456",
    // Kept only for a failure: a passing run should leave nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        // The preinstalled browser. `playwright install` is not run in this
        // environment and must not be — see the repo's environment notes.
        launchOptions: {
          executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
  ],
  webServer: [
    {
      // The SPA. `/api/val/static` is where the Next app expects to find it.
      command: "pnpm --filter @valbuild/ui run dev",
      url: "http://localhost:5173/api/val/static",
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: ".",
    },
    {
      command: "pnpm run dev",
      url: "http://localhost:3456",
      reuseExistingServer: true,
      timeout: 180_000,
      cwd: "./examples/next",
    },
  ],
});
