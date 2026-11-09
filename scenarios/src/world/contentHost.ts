import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Val's content service, for a world whose server runs in `http` mode: the
 * mock content host the proxy-mode Playwright projects run
 * (`e2e/mock-content-host/server.ts`), imported into the test's process
 * instead of started beside it.
 *
 * An edge, like the network: the content service is valbuild/home's, not
 * this repository's, and the mock is the stand-in CI already holds to home's
 * wire contract (`homeWireContract.test.ts`, the `chromium-http` specs). The
 * app's server reaches it over real HTTP on localhost, with the global
 * `fetch` `ValOpsHttp` uses -- so nothing in Val is told it is in a test.
 *
 * One mock per jest worker: its state is a module's, so the host is reset
 * between worlds rather than made again (`/__test__/reset`, as each
 * Playwright spec does), and listens on a new port for each.
 */
export type ContentHost = {
  /** Where `valContentUrl` points. */
  url: string;
  /** What the host checks every call's `Authorization` against. */
  apiKey: string;
  /** The project, as `val.config.ts`'s `project` names it. */
  project: string;
  /** The commit the host's chain starts at: the build's `gitCommit`. */
  initialCommit: string;
  /** The project's branch. */
  branch: string;
  /** Requests the app's server has made to the host and not had answered. */
  inFlight(): number;
  /** Puts the host back to empty, then stops listening. */
  stop(): Promise<void>;
};

const API_KEY = "scenario-api-key";
const PROJECT = "scenarios/world";
const INITIAL_COMMIT = "scenariocommit0";
const BRANCH = "main";

let started: Promise<Server> | null = null;

/**
 * The project's repository as the content host reads it (`PUT /files`, for
 * the text a publish patches): one directory per jest worker, holding each
 * world's source text while the world runs.
 */
const repoRoot = mkdtempSync(join(tmpdir(), "val-scenario-repo-"));

/**
 * `sourceText` is the project's files, by path from the repository root: what
 * the content service holds of the project, and what a publish reads back.
 */
export async function startContentHost(
  sourceText: Record<string, string>,
): Promise<ContentHost> {
  rmSync(repoRoot, { recursive: true, force: true });
  for (const [path, text] of Object.entries(sourceText)) {
    const file = join(repoRoot, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  if (started === null) {
    started = (async () => {
      // Read by the mock at import: a module's constants. Its port only
      // names the socket's url in a nonce answer, which no world asks for.
      process.env.MOCK_CONTENT_PORT = String(await freePort());
      process.env.MOCK_CONTENT_API_KEY = API_KEY;
      process.env.MOCK_CONTENT_PROJECT = PROJECT;
      process.env.MOCK_CONTENT_INITIAL_COMMIT = INITIAL_COMMIT;
      process.env.MOCK_CONTENT_BRANCH = BRANCH;
      process.env.MOCK_CONTENT_REPO_ROOT = repoRoot;
      process.env.MOCK_CONTENT_NO_LISTEN = "1";
      const { server } = await import("../../../e2e/mock-content-host/server");
      return server;
    })();
  }
  const server = await started;
  // A port of its own per world: `fetch` keeps connections to an origin
  // open, and the previous world's were closed under it, so the same port
  // again answers the next world's first call with a dead socket.
  const port = await freePort();
  let inFlight = 0;
  const count = (
    _req: unknown,
    res: { once(event: "close", listener: () => void): void },
  ) => {
    inFlight++;
    res.once("close", () => {
      inFlight--;
    });
  };
  server.on("request", count);
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const url = `http://localhost:${port}`;
  return {
    url,
    apiKey: API_KEY,
    project: PROJECT,
    initialCommit: INITIAL_COMMIT,
    branch: BRANCH,
    inFlight: () => inFlight,
    async stop() {
      await fetch(`${url}/__test__/reset`, { method: "POST" });
      server.off("request", count);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      rmSync(repoRoot, { recursive: true, force: true });
    },
  };
}

/** A port nothing on this machine listens on, from the OS. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      probe.close(() => {
        if (address === null || typeof address === "string") {
          reject(new Error("no port"));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}
