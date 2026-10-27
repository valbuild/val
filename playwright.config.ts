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
import { TANSTACK_APP_PORT } from "./e2e/tanstack/config";
import { TANSTACK_APP_URL } from "./e2e/apps";

const PREINSTALLED_CHROMIUM =
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/**
 * The projects named with `--project`, or none for "all of them".
 *
 * Read off argv because the config has to answer two questions before
 * Playwright has resolved anything: which projects to declare, and which
 * servers to start.
 */
const requestedProjects = new Set(
  process.argv.flatMap((arg, index) => {
    if (arg.startsWith("--project=")) {
      return [arg.slice("--project=".length)];
    }
    if (arg === "--project") {
      const next = process.argv[index + 1];
      return next === undefined ? [] : [next];
    }
    return [];
  }),
);

/** Whether a project will run, given what was asked for. */
function willRun(project: string): boolean {
  return requestedProjects.size === 0 || requestedProjects.has(project);
}

/**
 * Whether `--project=screens` was asked for by name.
 *
 * Declaring a project is NOT how you make one opt-in: `playwright test` with no
 * `--project` runs every configured project, so `pnpm run test:e2e` would still
 * run the screenshot script and could still be failed by it — which is the one
 * thing keeping it out of `chromium` was supposed to prevent. It has to be
 * absent from the config entirely unless it was named.
 */
const screensRequested =
  requestedProjects.has("screens") || process.env.VAL_E2E_SCREENS === "1";
/*
 * Carried to the workers in the environment, because argv does not reach them.
 *
 * A worker re-evaluates this file in its own process, and its argv is
 * Playwright's own — no `--project=screens` in it. So the project was declared
 * in the runner and absent in every worker, and `--project=screens` failed with
 * "Project "screens" not found in the worker process" no matter how it was
 * invoked: the script could not be run at all. Workers are forked after the
 * config is evaluated, so they inherit whatever is set here.
 */
if (requestedProjects.has("screens")) {
  process.env.VAL_E2E_SCREENS = "1";
}

/**
 * Whether a WebKit project (`webkit-http`, `webkit-tanstack-http`) was asked
 * for by name.
 *
 * Opt-in for the reason `screens` is: a bare `playwright test` runs every
 * project there is, and WebKit is not installed where most people run this --
 * it needs `playwright install --with-deps webkit`. Carried to the workers in
 * the environment for the same reason as `VAL_E2E_SCREENS`.
 */
const WEBKIT_PROJECTS = ["webkit-http", "webkit-tanstack-http"];
const webkitRequested =
  WEBKIT_PROJECTS.some((name) => requestedProjects.has(name)) ||
  process.env.VAL_E2E_WEBKIT === "1";
if (WEBKIT_PROJECTS.some((name) => requestedProjects.has(name))) {
  process.env.VAL_E2E_WEBKIT = "1";
}

/**
 * Which apps this run needs, and therefore which servers start.
 *
 * `webServer` is global with no per-project form, so for a long time every run
 * started every server. That was affordable while they were all the same app —
 * `next dev` compiles lazily, so an unused one cost a process — and stopped
 * being obviously so once a second framework joined: a `chromium` shard has no
 * use for a Vite server building a TanStack app, and the TanStack job has no
 * use for two copies of Next and a mock content host.
 *
 * Each of these asks the same question of a DIFFERENT app, so they are separate
 * rather than one flag:
 */
/** `examples/next`, in fs mode — the default app for most of the suite. */
const needsNextApp =
  willRun("chromium") || willRun("warmup") || willRun("screens");
/** `examples/tanstack`. */
const needsTanstackApp =
  willRun("tanstack") ||
  willRun("tanstack-warmup") ||
  willRun("chromium") ||
  willRun("warmup-tanstack");
/**
 * `examples/tanstack` again, in proxy mode, plus the mock content host: what
 * every proxy-mode project drives.
 */
const needsHttpApp =
  willRun("chromium-http") ||
  willRun("tanstack-http") ||
  willRun("http-warmup") ||
  (webkitRequested &&
    (willRun("webkit-http") ||
      willRun("webkit-tanstack-http") ||
      willRun("webkit-http-warmup")));

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
 * ## The servers, and why
 *
 * The Studio is a SPA served by Vite in dev; the app and its `/api/val` routes
 * are the framework's (TanStack Start, or Next). Neither alone is the thing
 * users run. So both start, and the tests drive the app's `/val` route the way
 * an editor would. Most of the suite drives `examples/tanstack` with its e2e
 * fixtures on; the specs that pin themselves to `examples/next` (see
 * `e2e/apps.ts`) are why a `chromium` shard starts that app too.
 *
 * `reuseExistingServer` so a developer with servers already up does not wait for
 * two more, and so a failing test can be re-run against the same processes.
 *
 * ## And two more, for `http` mode
 *
 * Everything under `e2e/http/` and `e2e/tanstack-http/` needs the app running
 * in proxy mode against a content service, which `fs` mode has no equivalent
 * of: publishing as a git commit, patches marked applied instead of deleted,
 * deployment and build events arriving over a WebSocket. So a mock content host
 * (`e2e/mock-content-host`) and a second `vite dev` of `examples/tanstack`
 * configured to talk to it come up alongside the others.
 *
 * Which of these start depends on the project asked for. `webServer` is global
 * with no per-project form, so the selection is made in the config itself (see
 * `needsNextApp` and friends above): a `chromium` shard starts the SPA and both
 * fs-mode apps, the proxy-mode projects start the mock host and the proxy-mode
 * app, and `tanstack` starts neither Next nor the mock. A bare `playwright
 * test` starts all of them, because it runs all of them.
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
      // Not a test: it asks the dev server to build the routes the suite is
      // about to visit, so no later test is the one paying for a compile inside
      // its own timeout. See `e2e/warmup.setup.ts`.
      name: "warmup",
      testMatch: "warmup.setup.ts",
      use: {
        launchOptions: {
          ...(existsSync(PREINSTALLED_CHROMIUM)
            ? { executablePath: PREINSTALLED_CHROMIUM }
            : {}),
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
    {
      // The same warm-up, for the TanStack app the `chromium` project drives
      // by default: every route it asks for is one of the e2e fixtures there
      // too.
      name: "warmup-tanstack",
      testMatch: "warmup.setup.ts",
      use: {
        baseURL: TANSTACK_APP_URL,
        launchOptions: {
          ...(existsSync(PREINSTALLED_CHROMIUM)
            ? { executablePath: PREINSTALLED_CHROMIUM }
            : {}),
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
    {
      /**
       * The fs-mode suite: `examples/tanstack`, with the e2e fixtures on.
       *
       * It drove `examples/next` until the move to TanStack Start, the primary
       * release target. The specs that pin themselves to Next (see
       * `e2e/apps.ts`) keep `@valbuild/next` covered, which is why both
       * warm-ups run and both apps start.
       */
      name: "chromium",
      // Every fs-mode test starts against an app that has already compiled its
      // routes, rather than against whichever route the run happened to hit
      // first. This is why the timeouts below can be read as claims about the
      // app rather than about the runner.
      dependencies: ["warmup", "warmup-tanstack"],
      // The `fs`-mode suites. `e2e/http/` is excluded because those tests need
      // the other app, on the other port. `screens.spec.ts` is excluded because
      // it is not a test — it takes screenshots for a human to look at, on a
      // fixed schedule of `waitForTimeout`s that adds up to ~40s of its own —
      // and it should not be able to turn a run red or fail a CI gate. Run it
      // explicitly with the `screens` project below.
      testIgnore: [
        "http/**",
        "tanstack/**",
        "tanstack-http/**",
        "screens.spec.ts",
      ],
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
        baseURL: TANSTACK_APP_URL,
      },
    },
    {
      /**
       * The proxy-mode suite, `e2e/http/`: publishing, deployments, history,
       * two editors, remote files, the assistant.
       *
       * Against the proxy-mode copy of `examples/tanstack` (see
       * `e2e/http/config.ts`). The name is the browser and the mode, which is
       * what CI's matrix selects it by; it drove `examples/next` until `next
       * dev` kept failing these specs on its own manifests.
       */
      name: "chromium-http",
      dependencies: ["http-warmup"],
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
      // Not a test: it loads the Studio once so no TanStack test is the one
      // paying for Vite's first transform of the SPA. See `warm.setup.ts`.
      name: "tanstack-warmup",
      testMatch: "tanstack/warm.setup.ts",
      use: {
        baseURL: `http://localhost:${TANSTACK_APP_PORT}`,
        launchOptions: {
          ...(existsSync(PREINSTALLED_CHROMIUM)
            ? { executablePath: PREINSTALLED_CHROMIUM }
            : {}),
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
    {
      /**
       * `examples/tanstack`, which nothing else in this suite touches.
       *
       * The catastrophe detector (`e2e/tanstack/studio.spec.ts`) and the
       * specs whose fixtures are in the TanStack showcase (`video.spec.ts`). No `warmup` dependency: that project drives the
       * NEXT app, which this one does not start.
       */
      name: "tanstack",
      dependencies: ["tanstack-warmup"],
      testMatch: "tanstack/**/*.spec.ts",
      use: {
        baseURL: `http://localhost:${TANSTACK_APP_PORT}`,
        launchOptions: {
          ...(existsSync(PREINSTALLED_CHROMIUM)
            ? { executablePath: PREINSTALLED_CHROMIUM }
            : {}),
          args: ["--no-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
    {
      // Not a test: the `tanstack-warmup` of the proxy-mode copy, which every
      // proxy-mode project depends on. See `e2e/tanstack-http/warm.setup.ts`.
      name: "http-warmup",
      testMatch: "tanstack-http/warm.setup.ts",
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
      /**
       * The builder tab (`publishHandoff.spec.ts`), on the same app as
       * `chromium-http`.
       *
       * A project of its own only because CI runs it as one: it was the first
       * spec moved off `next dev`, and it loads a second Studio per test, so
       * it is the slowest file in the proxy-mode suite.
       */
      name: "tanstack-http",
      dependencies: ["http-warmup"],
      testMatch: "tanstack-http/**/*.spec.ts",
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
    /*
     * Publishing in Safari's engine: what an editor on an iPhone or a Mac
     * runs, and what `chromium-http` cannot speak for. Only present when asked
     * for by name: see `webkitRequested`.
     *
     * `webkit-http`: the specs that publish and then hold the open Studio to
     * what a reload shows -- the bugs there lived in the websocket and the
     * stores, which every engine runs, but only running them says so.
     *
     * `webkit-tanstack-http`: the Publish BUTTON on a Studio that cannot
     * build, which opens a builder tab. Until `publishHandoff.spec.ts` ran in
     * WebKit no spec pressed it there, so a hand-off that hung in Safari
     * showed up on a phone first. The one test that freezes a page skips
     * itself, since freezing is a CDP command.
     */
    ...(webkitRequested
      ? [
          {
            // The warm-up, in WebKit: the jobs that run these install no
            // other browser.
            name: "webkit-http-warmup",
            testMatch: "tanstack-http/warm.setup.ts",
            use: {
              baseURL: `http://localhost:${HTTP_APP_PORT}`,
              browserName: "webkit" as const,
            },
          },
          {
            name: "webkit-http",
            dependencies: ["webkit-http-warmup"],
            testMatch: [
              "http/reloadEquivalence.spec.ts",
              "http/publish.spec.ts",
            ],
            use: {
              baseURL: `http://localhost:${HTTP_APP_PORT}`,
              browserName: "webkit" as const,
            },
          },
          {
            name: "webkit-tanstack-http",
            dependencies: ["webkit-http-warmup"],
            testMatch: "tanstack-http/**/*.spec.ts",
            use: {
              baseURL: `http://localhost:${HTTP_APP_PORT}`,
              browserName: "webkit" as const,
            },
          },
        ]
      : []),
    // Not a test project, and only present when asked for by name:
    // `pnpm exec playwright test --project=screens` takes screenshots of the
    // shell for a human to look at. It asserts nothing about correctness and
    // spends ~40s in fixed `waitForTimeout`s, so it must not be able to turn a
    // run red — and merely keeping it out of `chromium` does not achieve that,
    // since a bare `playwright test` runs every project there is.
    ...(screensRequested
      ? [
          {
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
        ]
      : []),
  ],
  webServer: [
    {
      // The SPA, which every app proxies at `/api/val/static` in dev. Always
      // started: it is the thing under test in every project.
      command: "pnpm --filter @valbuild/ui run dev",
      url: "http://localhost:5173/api/val/static",
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: ".",
    },
    ...(needsNextApp
      ? [
          {
            command: "pnpm run dev",
            url: "http://localhost:3456",
            reuseExistingServer: true,
            timeout: 180_000,
            cwd: "./examples/next",
          },
        ]
      : []),
    ...(needsTanstackApp
      ? [
          {
            /**
             * `examples/tanstack`, on the port its own `dev` script binds.
             *
             * Waiting on `/` rather than on `/val`: Vite compiles on demand, so
             * whichever URL is waited on here is the one compile the suite does
             * not pay for inside a test timeout — and the site route is the
             * cheaper of the two.
             */
            command: "pnpm run dev",
            url: `http://localhost:${TANSTACK_APP_PORT}`,
            reuseExistingServer: true,
            timeout: 180_000,
            cwd: "./examples/tanstack",
            // The e2e fixtures (`examples/tanstack/content/`), which the
            // `chromium` project's specs edit. Local media only: the remote
            // fixtures need a content host, which only the proxy-mode copy has.
            env: { VAL_E2E_FIXTURES: "true" },
          },
        ]
      : []),
    ...(needsHttpApp
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
              /*
               * The mock has to agree with the app about whether this project
               * has a repository.
               *
               * The app below is given `VAL_GIT_COMMIT` unless
               * `VAL_E2E_MANAGED` says otherwise, so the same switch decides
               * both halves. They disagreed until the Studio started reading
               * `sourceMode`: the mock called every project managed while the
               * default run built the app FROM a repository, which is a
               * contradiction -- a managed project has none, so no build of one
               * can have been made from a commit. Nothing noticed, because the
               * only reader was `publishRefusal`, which asks about the pair and
               * so was satisfied by either half being connected.
               */
              ...(process.env.VAL_E2E_MANAGED
                ? { MOCK_CONTENT_SOURCE_MODE: "managed" }
                : { MOCK_CONTENT_SOURCE_MODE: "connected" }),
            },
          },
          {
            /**
             * `examples/tanstack` again, in proxy mode.
             *
             * No product code and no second config: `initHandlerOptions` reads
             * `VAL_API_KEY` and `VAL_SECRET` from the environment and they
             * select proxy mode, and `vite dev` runs the server in this
             * process's environment. The project comes from the app's own
             * `val.config.ts`, which the mock above was started with.
             *
             * `vite dev` rather than the `dev` script, which binds the fs-mode
             * port; `--strictPort` so a busy port fails here instead of moving
             * the app somewhere the tests are not looking. Its own Vite cache,
             * for the reason `NEXT_DIST_DIR` keeps two Next servers' builds
             * apart (see `examples/tanstack/vite.config.ts`).
             */
            command: `pnpm exec vite dev --port ${HTTP_APP_PORT} --strictPort`,
            url: `http://localhost:${HTTP_APP_PORT}`,
            reuseExistingServer: true,
            timeout: 180_000,
            cwd: "./examples/tanstack",
            env: {
              VAL_E2E_VITE_CACHE_DIR: "node_modules/.vite-http",
              // The suite's fixtures (`examples/tanstack/content/`), and their
              // remote media: only this server has a content host that answers
              // for remote files. See `examples/tanstack/val.modules.ts`.
              VAL_E2E_FIXTURES: "true",
              VAL_E2E_REMOTE_MEDIA: "true",
              VAL_API_KEY: MOCK_API_KEY,
              VAL_SECRET: MOCK_SECRET,
              /*
               * A repository to mirror commits into -- unless the run says
               * otherwise.
               *
               * `VAL_E2E_MANAGED=1` omits both, which is a project whose
               * content service is the store of record: no repository, no
               * commit baked into the build, http mode on credentials alone.
               */
              ...(process.env.VAL_E2E_MANAGED
                ? {}
                : {
                    VAL_GIT_COMMIT: MOCK_INITIAL_COMMIT,
                    VAL_GIT_BRANCH: "main",
                  }),
              VAL_CONTENT_URL: `http://localhost:${MOCK_CONTENT_PORT}`,
              VAL_BUILD_URL: `http://localhost:${MOCK_CONTENT_PORT}`,
            },
          },
        ]
      : []),
  ],
});
