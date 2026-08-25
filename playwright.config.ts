import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
import {
  MOCK_API_KEY,
  MOCK_CONTENT_PORT,
  MOCK_INITIAL_COMMIT,
  MOCK_PROJECT,
  MOCK_SECRET,
  HTTP_APP_PORT,
} from "./e2e/http/config";

const PREINSTALLED_CHROMIUM =
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

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
 *
 * ## And two more, for `http` mode
 *
 * Everything under `e2e/http/` needs the app running in proxy mode against a
 * content service, which `fs` mode has no equivalent of: publishing as a git
 * commit, patches marked applied instead of deleted, deployment and build events
 * arriving over a WebSocket. So a mock content host (`e2e/mock-content-host`) and
 * a second `next dev` configured to talk to it come up alongside the other two.
 *
 * They start on every run rather than only when the `http` project is selected —
 * Playwright's `webServer` is global, with no per-project form — but `next dev`
 * compiles lazily, so an FS-only run pays for a process, not a build.
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
      // The `fs`-mode suites. `e2e/http/` is excluded because those tests need
      // the other app, on the other port.
      testIgnore: "http/**",
      use: {
        launchOptions: {
          /**
           * The preinstalled browser, when there is one.
           *
           * Some sandboxes ship Chromium at a fixed path and forbid
           * `playwright install`; CI installs its own and has nothing at that
           * path. Pinning it unconditionally made the suite unrunnable on a
           * runner, and leaving it out made it unrunnable in the sandbox — so it
           * is used when it exists and Playwright resolves its own otherwise.
           */
          ...(existsSync(PREINSTALLED_CHROMIUM)
            ? { executablePath: PREINSTALLED_CHROMIUM }
            : {}),
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
    {
      name: "chromium-http",
      testMatch: "http/**/*.spec.ts",
      use: {
        baseURL: `http://localhost:${HTTP_APP_PORT}`,
        launchOptions: {
          ...(existsSync(PREINSTALLED_CHROMIUM)
            ? { executablePath: PREINSTALLED_CHROMIUM }
            : {}),
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
    {
      // The fake content.val.build. Must be up before the app below: the app
      // asks it for patches on the first `/stat`.
      command: "pnpm exec tsx e2e/mock-content-host/server.ts",
      url: `http://localhost:${MOCK_CONTENT_PORT}/__test__/ping`,
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: ".",
      env: {
        MOCK_CONTENT_PORT: String(MOCK_CONTENT_PORT),
        MOCK_CONTENT_API_KEY: MOCK_API_KEY,
        MOCK_CONTENT_PROJECT: MOCK_PROJECT,
        MOCK_CONTENT_REPO_ROOT: process.cwd(),
        MOCK_CONTENT_INITIAL_COMMIT: MOCK_INITIAL_COMMIT,
      },
    },
    {
      /**
       * The same example app, in proxy mode.
       *
       * `initHandlerOptions` picks proxy mode from the environment alone —
       * `VAL_API_KEY` and `VAL_SECRET` present means `http` — so this needs no
       * product code and no second config file. `NEXT_DIST_DIR` keeps its build
       * output away from the `fs`-mode server's.
       */
      command: `pnpm exec next dev -p ${HTTP_APP_PORT}`,
      url: `http://localhost:${HTTP_APP_PORT}`,
      reuseExistingServer: true,
      timeout: 180_000,
      cwd: "./examples/next",
      env: {
        NEXT_DIST_DIR: ".next-http",
        VAL_API_KEY: MOCK_API_KEY,
        VAL_SECRET: MOCK_SECRET,
        VAL_PROJECT: MOCK_PROJECT,
        VAL_GIT_COMMIT: MOCK_INITIAL_COMMIT,
        VAL_GIT_BRANCH: "main",
        VAL_CONTENT_URL: `http://localhost:${MOCK_CONTENT_PORT}`,
        VAL_BUILD_URL: `http://localhost:${MOCK_CONTENT_PORT}`,
      },
    },
  ],
});
