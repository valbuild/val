/**
 * The Studio in PROXY mode, on a laptop, in one command.
 *
 * `pnpm run dev:example-next` gives you `fs` mode, where the content host is a
 * directory and the server is `ValOpsFS`. That is most of the product, but it
 * is not the half a deployed app runs: publishing as a git commit, patches
 * marked applied rather than deleted, deployments over a WebSocket — and
 * history, which `ValOpsFS` answers `not-supported-in-fs-mode` for, so the
 * History button is not even rendered there.
 *
 * Every piece needed to run that half locally already existed for the e2e
 * suite: `e2e/mock-content-host` is a faithful content service, and
 * `playwright.config.ts` starts a second `next dev` pointed at it. What was
 * missing was a way for a HUMAN to use it. This is that way, and it is the same
 * three processes with the same configuration — `e2e/http/config.ts` is
 * imported rather than copied, so there is one set of ports and secrets and a
 * drift between the tests and the dev stack cannot happen.
 *
 * Two things this adds that the test harness does not need:
 *
 * - **A login.** Proxy mode refuses every request without a signed session and
 *   the real login goes to admin.val.build. The tests mint a cookie into a
 *   browser context; a person cannot, so the mock is started with the signing
 *   secret and serves `/__test__/login`.
 * - **A history worth opening.** The mock holds its commits in memory and comes
 *   up empty. See `scripts/seedHistory.ts`.
 *
 * The `fs`-mode stack on 3456 is untouched and can run at the same time, which
 * is the point of the separate ports: comparing the two modes needs no restart.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  HTTP_APP_PORT,
  MOCK_API_KEY,
  MOCK_CONTENT_PORT,
  MOCK_INITIAL_COMMIT,
  MOCK_PROJECT,
  MOCK_SECRET,
} from "../e2e/http/config";
import { seedHistory } from "./seedHistory";

const ROOT = new URL("..", import.meta.url).pathname;
const APP_URL = `http://localhost:${HTTP_APP_PORT}`;
const MOCK_URL = `http://localhost:${MOCK_CONTENT_PORT}`;
/** Where Vite serves the Studio, as the Next app expects to find it. */
const UI_URL = "http://localhost:5173/api/val/static";

const seedRequested = !process.argv.includes("--no-seed");

const children: ChildProcess[] = [];

function start(
  name: string,
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
  },
): ChildProcess {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    // Inherited rather than captured: this is a dev server, and the compile
    // errors and request logs ARE the output a developer is running it for.
    stdio: "inherit",
    /*
     * Its own process group, so it can be killed as one.
     *
     * Every command here is `pnpm`, which execs the real server as a CHILD —
     * so signalling the pid signals the wrapper and leaves `vite` and
     * `next-server` running. They then hold 5173 and 3457, and the NEXT run of
     * this script is refused by `assertPortFree` for a stack the developer
     * believes they already stopped.
     */
    detached: true,
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `\n[dev:http] ${name} exited (${signal ?? code}). Shutting the rest down.`,
    );
    shutdown(typeof code === "number" && code !== 0 ? code : 1);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;

/** Signal a child's whole process group, not just the `pnpm` that spawned it. */
function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    // The negated pid is the group — see `detached` in `start`.
    process.kill(-child.pid, signal);
  } catch {
    // Already gone, or never got a group. Falling back to the pid alone is
    // still better than leaving it.
    try {
      child.kill(signal);
    } catch {
      /* it is gone */
    }
  }
}

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    killGroup(child, "SIGTERM");
  }
  // Long enough for `next dev` to put its terminal back, short enough not to
  // feel like a hang. Anything still up after it gets SIGKILL rather than being
  // left holding a port.
  setTimeout(() => {
    for (const child of children) {
      killGroup(child, "SIGKILL");
    }
    process.exit(code);
  }, 1000);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0));
}

/**
 * Refuse to start on top of something already listening.
 *
 * Worth a preflight rather than letting it happen, because the cascade is
 * genuinely misleading: Vite quietly moves to the next free port, so the Next
 * server looks for the Studio where it is not, and `waitFor` below accepts ANY
 * answer — so a stale app left on 3457 is "ready" instantly and the seed
 * publishes into it. The visible failure is then an EADDRINUSE from one process
 * mixed into three other logs, several seconds after the one that mattered.
 */
async function assertPortFree(name: string, port: number): Promise<void> {
  try {
    await fetch(`http://localhost:${port}`);
  } catch {
    return;
  }
  throw new Error(
    `Something is already listening on ${port} (${name}). Stop it first — a ` +
      `previous \`dev:example-next:http\` or a Playwright run leaves these up.`,
  );
}

/**
 * Wait for a URL to answer at all.
 *
 * Any response counts, including a 401 or a 404: the question is whether the
 * process is listening, and `next dev` compiles lazily — a route that has not
 * been asked for yet is not a sign that the server is down.
 */
async function waitFor(
  name: string,
  url: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (shuttingDown) return;
    try {
      await fetch(url);
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(`${name} never came up at ${url}`);
      }
      await delay(500);
    }
  }
}

async function main(): Promise<void> {
  await assertPortFree("content host", MOCK_CONTENT_PORT);
  await assertPortFree("studio (vite)", 5173);
  await assertPortFree("examples/next", HTTP_APP_PORT);

  // The mock first: the app asks it for patches on its first `/stat`, and a
  // Next server that starts against a content host that is not listening
  // reports it as a connection error rather than retrying.
  start(
    "mock content host",
    "pnpm",
    ["exec", "tsx", "e2e/mock-content-host/server.ts"],
    {
      cwd: ROOT,
      env: {
        MOCK_CONTENT_PORT: String(MOCK_CONTENT_PORT),
        MOCK_CONTENT_API_KEY: MOCK_API_KEY,
        MOCK_CONTENT_PROJECT: MOCK_PROJECT,
        MOCK_CONTENT_REPO_ROOT: ROOT,
        MOCK_CONTENT_INITIAL_COMMIT: MOCK_INITIAL_COMMIT,
        // Only set here, never under Playwright: this is what turns
        // `/__test__/login` on. See the mock's SESSION_SECRET.
        MOCK_CONTENT_SESSION_SECRET: MOCK_SECRET,
        MOCK_CONTENT_APP_URL: APP_URL,
      },
    },
  );
  await waitFor("mock content host", `${MOCK_URL}/__test__/ping`, 30_000);

  start("studio (vite)", "pnpm", ["--filter", "@valbuild/ui", "run", "dev"], {
    cwd: ROOT,
  });

  start(
    "examples/next (proxy mode)",
    "pnpm",
    ["exec", "next", "dev", "--webpack", "-p", String(HTTP_APP_PORT)],
    {
      cwd: `${ROOT}examples/next`,
      env: {
        /*
         * Proxy mode is picked from the environment alone — `initHandlerOptions`
         * reads an api key and a secret as "talk to a content service" — so this
         * needs no second config file and no product code.
         */
        VAL_API_KEY: MOCK_API_KEY,
        VAL_SECRET: MOCK_SECRET,
        VAL_PROJECT: MOCK_PROJECT,
        VAL_GIT_COMMIT: MOCK_INITIAL_COMMIT,
        VAL_GIT_BRANCH: "main",
        VAL_CONTENT_URL: MOCK_URL,
        VAL_BUILD_URL: MOCK_URL,
        // Away from the fs-mode server's build output, so both can run at once.
        NEXT_DIST_DIR: ".next-http",
        // The remote-file example module, which only this server registers.
        NEXT_PUBLIC_VAL_EXAMPLE_REMOTE_MEDIA: "true",
      },
    },
  );

  await waitFor("studio (vite)", UI_URL, 120_000);
  await waitFor("examples/next", APP_URL, 180_000);
  if (shuttingDown) return;

  if (seedRequested) {
    try {
      await seedHistory();
    } catch (err) {
      // Never fatal. A stack with an empty History pane is still a stack, and
      // taking it down over the fixtures would be a worse trade than saying so.
      console.warn("[dev:http] could not seed a history:", err);
    }
  }
  // A child can have died while the seed was in flight, and a "here is your
  // Studio" banner printed underneath its stack trace is how a dev ends up
  // opening a URL nothing is serving.
  if (shuttingDown) return;

  console.log(
    [
      "",
      "  Val Studio, proxy mode",
      "",
      `  Log in and open it:  ${MOCK_URL}/__test__/login`,
      `                       ${MOCK_URL}/__test__/login?user=linus  (as the other editor)`,
      "",
      `  App                  ${APP_URL}`,
      `  Content host         ${MOCK_URL}`,
      `  Re-seed the history  pnpm run seed:history`,
      "",
      "  The commit list is in memory: restarting the content host empties it.",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error("[dev:http]", err);
  shutdown(1);
});
