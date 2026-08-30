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
 * Which projects this invocation will run, read off the command line.
 *
 * `webServer` is global — Playwright has no per-project form — so without this
 * every run would start every server: an `fs`-mode run, whose workers bring up
 * their own apps, would still pay for a `next dev` and a mock content host it
 * never touches, and `next dev`'s first-request compile is most of what this
 * whole change removes. Reading `--project` is unlovely, but the alternative is
 * a config that cannot express "this server belongs to that project".
 *
 * No `--project` means "all of them", which is what Playwright itself does.
 */
const selectedProjects: string[] = process.argv.reduce<string[]>(
  (found, arg, index) => {
    if (arg === "--project" && process.argv[index + 1]) {
      found.push(process.argv[index + 1]);
    } else if (arg.startsWith("--project=")) {
      found.push(arg.slice("--project=".length));
    }
    return found;
  },
  [],
);
const willRun = (project: string): boolean =>
  selectedProjects.length === 0 || selectedProjects.includes(project);

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
  /**
   * Parallel, because each worker now gets an app of its own.
   *
   * This used to be `workers: 1`, and had to be: every spec drove one server
   * against one `examples/next/.val`, so two workers would have been editing
   * each other's content and the failure would have read as a bug in the store
   * rather than in the harness. `e2e/workerApp.ts` removes the shared thing —
   * a copied tree and a `next dev` of its own per worker, isolated by nothing
   * more exotic than `process.cwd()`, which is what `fs` mode takes as its
   * root. The Vite server below stays shared: it holds no per-app state.
   *
   * `fullyParallel` stays off: files still run whole, on one worker. Several
   * specs are written as a sequence (`studio.spec.ts` composes on its own
   * writes; `large-patch-chain.spec.ts` builds a fixture in `beforeAll`), so
   * spreading the tests inside a file across workers would break them for a
   * reason that has nothing to do with the product.
   */
  /**
   * Two, not one per core, and measured rather than guessed.
   *
   * Every worker runs a `next dev` that compiles the app's routes with webpack
   * as the tests hit them, so a worker is CPU-hungry in bursts and not merely
   * an extra browser. On a 4-core box, four workers took 17.2 minutes against
   * a 19.9-minute serial run — 40 minutes of CPU inside 17 of wall clock, so
   * the work parallelised fine and the machine simply had nowhere to put it —
   * and the contention timed two tests out that pass at lower concurrency.
   *
   * GitHub's standard `ubuntu-latest` runner is also 4 vCPU, so a high worker
   * count buys little there either. If the suite's wall clock matters, the
   * lever is `--shard` across several runners — each shard gets its own
   * machine, and no shard contends with another — not more workers inside one.
   */
  workers: process.env.CI ? 2 : undefined,
  fullyParallel: false,
  // A generous timeout, and not because the app is slow: `next dev` compiles the
  // route on first request, so the first test pays for a build.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    // No `baseURL` here on purpose: `fs`-mode tests get one per worker from
    // `e2e/workerApp.ts`, and `chromium-http` sets its own below. A default
    // would silently point a mis-wired test at whatever happens to be running.
    // Kept only for a failure: a passing run should leave nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // The `fs`-mode suites. `e2e/http/` is excluded because those tests need
      // the other app, on the other port. `screens.spec.ts` is excluded because
      // it is not a test — it takes screenshots for a human to look at, on a
      // fixed schedule of `waitForTimeout`s that adds up to ~40s of its own —
      // and it should not be able to turn a run red or fail a CI gate. Run it
      // explicitly with the `screens` project below.
      testIgnore: ["http/**", "screens.spec.ts"],
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
    {
      // Not a test project: `npx playwright test --project=screens` (or
      // `screens.spec.ts` by file name, which still resolves to this project)
      // takes screenshots of the shell for a human to look at. Kept out of
      // `chromium` so it cannot fail a run; kept as its own project rather than
      // deleted so it stays one command to re-run after a redesign.
      name: "screens",
      testMatch: "screens.spec.ts",
      use: {
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
    /**
     * The SPA, and the one server that is still shared.
     *
     * `/api/val/static` is where the Next app expects to find it, on a port
     * hardcoded in `packages/ui/src/server.ts`. That looked like the blocker
     * for running workers in parallel — one port, no config knob — but it is
     * not: this server only serves SPA assets and holds no per-app state, so
     * every worker's app can proxy to the same one. The app is the only thing
     * that had to become per-worker, and `e2e/workerApp.ts` is where that
     * happens.
     */
    {
      command: "pnpm --filter @valbuild/ui run dev",
      url: "http://localhost:5173/api/val/static",
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: ".",
    },
    ...(willRun("chromium-http")
      ? [
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
            // `--webpack` for the same reason the `dev` script has it, see next.config.js.
            command: `pnpm exec next dev --webpack -p ${HTTP_APP_PORT}`,
            url: `http://localhost:${HTTP_APP_PORT}`,
            reuseExistingServer: true,
            timeout: 180_000,
            cwd: "./examples/next",
            env: {
              NEXT_DIST_DIR: ".next-http",
              // The remote-file example, which only this server registers: a remote
              // schema makes the Studio ask for remote settings and makes every publish
              // require remote credentials, so the fs-mode server has to stay without
              // one. See examples/next/val.modules.ts.
              NEXT_PUBLIC_VAL_EXAMPLE_REMOTE_MEDIA: "true",
              VAL_API_KEY: MOCK_API_KEY,
              VAL_SECRET: MOCK_SECRET,
              VAL_PROJECT: MOCK_PROJECT,
              VAL_GIT_COMMIT: MOCK_INITIAL_COMMIT,
              VAL_GIT_BRANCH: "main",
              VAL_CONTENT_URL: `http://localhost:${MOCK_CONTENT_PORT}`,
              VAL_BUILD_URL: `http://localhost:${MOCK_CONTENT_PORT}`,
            },
          },
        ]
      : []),
  ],
});
