import { test as base } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * One copy of the example app, and one server, per Playwright worker.
 *
 * ## Why a copy at all
 *
 * `fs` mode's root is `process.cwd()` — see `initHandlerOptions` in
 * `packages/server/src/ValRouter.ts`. Everything Val writes in this mode is
 * under it: the patch store in `.val/patches`, uploaded bytes under
 * `public/`, and — on publish — the project's own `*.val.ts` source files
 * (`ValOpsFS.saveSourceFile`). So a server started with a different cwd is a
 * fully independent Val instance, and giving each worker its own cwd is the
 * whole of what parallelism needs. No config override, no env var: `fs` is
 * already the default, and it is proxy mode that has to be opted into by
 * setting `VAL_API_KEY`/`VAL_SECRET`.
 *
 * The copy also fixes something the serial suite did badly: publish tests used
 * to edit the real `examples/next` working tree and put it back afterwards.
 * A throwaway copy cannot leave the checkout dirty however a test fails.
 *
 * ## Why `next dev` and not a production build
 *
 * A built app would be the more faithful thing to test — a consumer never runs
 * the Vite dev server, which `packages/ui/src/server.ts` describes as a shim
 * for developing Val itself. That was tried, and it cannot work: the suite
 * drives the Studio through `window.__VAL_STORES__`, and
 * `ValStoreProvider.tsx` deliberately does not expose it when
 * `NODE_ENV === "production"` — `System` carries write, publish and discard, so
 * on a real site that would hand a mutation surface to every script on the
 * page. The gate is written so the bundler strips it outright, and it does:
 * the built SPA bundle contains no reference to it at all.
 *
 * So the instrumentation this suite is built on exists only in a
 * development SPA, and testing the built artifact would mean either weakening
 * that gate or rewriting every spec to drive the UI blind — losing the
 * "assert through the store, because the failure was silent" property that
 * `large-patch-chain.spec.ts` and `studio.spec.ts` exist for.
 *
 * The Vite dev server stays shared, on its one hardcoded port. It only serves
 * SPA assets and holds no per-app state, so every worker can proxy to the same
 * one; the app is the only thing that needed to become per-worker.
 */

const REPO_ROOT = join(__dirname, "..");
const APP_SOURCE = join(REPO_ROOT, "examples", "next");
/** Worker N gets `BASE_PORT + N`, so the ports never collide. */
const BASE_PORT = Number(process.env.VAL_E2E_BASE_PORT ?? 3500);
const BOOT_TIMEOUT_MS = 120_000;

/**
 * Copy the app so the worker can write to it, without copying what it cannot.
 *
 * Only about 2 MB moves: `content/`, `app/`, `public/` and the configs — the
 * things a test mutates. Three exclusions:
 *
 * - **`node_modules`** is resolved, not written, so it is symlinked. Copying a
 *   pnpm tree per worker would be enormous and pointless.
 * - **`.next`/`.next-http`** are build output. Each worker's `next dev`
 *   compiles its own inside its own copy, so bringing one along would only be
 *   a stale cache.
 * - **`.val`** is the patch store, which is the whole thing being isolated. A
 *   worker starts with none, which is the clean state every spec wants.
 */
function copyApp(destination: string): void {
  mkdirSync(destination, { recursive: true });
  execFileSync(
    "bash",
    [
      "-c",
      `cd ${JSON.stringify(APP_SOURCE)} && ` +
        `tar --exclude=./.next --exclude=./.next-http --exclude=./node_modules --exclude=./.val -cf - . | ` +
        `tar -xf - -C ${JSON.stringify(destination)}`,
    ],
    { stdio: "pipe" },
  );
  execFileSync(
    "ln",
    ["-s", join(APP_SOURCE, "node_modules"), join(destination, "node_modules")],
    { stdio: "pipe" },
  );
}

async function waitForServer(
  port: number,
  child: ChildProcess,
  log: () => string,
): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `the app server exited before it was ready (code ${child.exitCode}):\n${log()}`,
      );
    }
    try {
      const res = await fetch(`http://localhost:${port}/api/val/enable`, {
        redirect: "manual",
      });
      // Any answer at all means the route is mounted and serving.
      if (res.status > 0) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the app server did not answer on port ${port} within ${BOOT_TIMEOUT_MS}ms:\n${log()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export type WorkerApp = {
  baseURL: string;
  /** The worker's own copy of the app — its Val `fs` root. */
  rootDir: string;
};

/**
 * `test`, with a private app instance per worker.
 *
 * `baseURL` is overridden rather than set in the config, because the config
 * cannot know which worker a test will land on and every worker is on a
 * different port. Tests keep using relative URLs and `page.goto("/val")`
 * unchanged.
 */
export const test = base.extend<object, { workerApp: WorkerApp }>({
  workerApp: [
    // Named rather than destructured as `{}`: this fixture consumes no other
    // fixtures, and an empty pattern is an eslint error.
    async (_fixtures, use, workerInfo) => {
      const port = BASE_PORT + workerInfo.workerIndex;
      const rootDir = join(
        workerInfo.project.outputDir,
        `app-worker-${workerInfo.workerIndex}`,
      );
      rmSync(rootDir, { recursive: true, force: true });
      copyApp(rootDir);

      let output = "";
      const child = spawn(
        join(APP_SOURCE, "node_modules", ".bin", "next"),
        // `--webpack` for the same reason the app's own `dev` script has it:
        // `@preconstruct/next` patches the webpack config to resolve the
        // workspace packages from source, and Turbopack ignores all of it.
        ["dev", "--webpack", "-p", String(port)],
        {
          cwd: rootDir,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            // Absent means `fs` mode. Deleted rather than trusted to be unset,
            // so a developer with these exported in their shell does not get a
            // proxy-mode server and a very confusing failure.
            VAL_API_KEY: undefined,
            VAL_SECRET: undefined,
            VAL_PROJECT: undefined,
            NEXT_DIST_DIR: undefined,
          },
        },
      );
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);

      try {
        await waitForServer(port, child, () => output);
        await use({ baseURL: `http://localhost:${port}`, rootDir });
      } finally {
        child.kill();
        await new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          setTimeout(() => resolve(), 5_000);
        });
        rmSync(rootDir, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ workerApp }, use) => {
    await use(workerApp.baseURL);
  },
});
