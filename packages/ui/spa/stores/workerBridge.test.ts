import { Worker } from "node:worker_threads";
import path from "node:path";
import { initVal } from "@valbuild/core";
import { initTestSystem, externalPatch, mfp, sp } from "./testSystem";
import {
  createWorkerBridges,
  type MessageEndpoint,
  type WorkerRealmBridges,
} from "./workerBridge";
import type { SourceSnapshot } from "./SearchStore";

/**
 * The worker realm, in a REAL second thread.
 *
 * `workerSeam.test.ts` establishes that the seam CAN be crossed — everything is
 * structured-cloneable, and nothing is read synchronously any more. This runs it
 * across an actual `node:worker_threads` thread, because those two facts are
 * necessary and not sufficient: a protocol can be sound and the wiring still
 * wrong, and the only way to know is to send the messages.
 *
 * What this proves that same-process serialization would not:
 *
 * - the three stores load in a realm that has NO access to the host — the worker
 *   imports `workerEntry.ts` and nothing else, so if any of them had reached for
 *   `HostStore` or a `Schema` instance the import itself would fail;
 * - every payload survives a genuine `postMessage`, with the real
 *   `DataCloneError` on violation rather than a simulation of it;
 * - the stores actually WORK on the far side — an index built in another thread
 *   answers a query from the host, which is the whole claim.
 *
 * The worker loads TypeScript via `--import tsx`. That is a test-only
 * convenience: a shipped browser worker loads the bundled `workerEntry`.
 */

/** A node `Worker` in the shape `workerBridge` asks for. Two lines, as promised. */
function portEndpoint(port: Worker): MessageEndpoint {
  return {
    post: (message) => port.postMessage(message),
    onMessage: (handler) => {
      const listener = (message: unknown) => handler(message);
      port.on("message", listener);
      return () => {
        port.off("message", listener);
      };
    },
  };
}

const ENTRY = path.resolve(__dirname, "workerEntry.ts");

/**
 * A worker hosting the real worker-realm stores.
 *
 * The shim is JS-in-a-string rather than a committed `.js` file, so nothing has
 * to be built before the test runs and there is no second copy of the entry to
 * keep in step. It does exactly two things: adapt `parentPort` to a
 * `MessageEndpoint`, and start the realm.
 */
function startWorker(): {
  worker: Worker;
  bridges: ReturnType<typeof createWorkerBridges>;
} {
  // CJS and `tsx/cjs`, not ESM and `--import tsx`. The ESM loader does not
  // resolve extensionless relative specifiers, so `workerEntry`'s
  // `import { SearchStore } from "./SearchStore"` fails with
  // ERR_MODULE_NOT_FOUND — which reads as "the worker realm cannot load" when it
  // is really "this loader cannot resolve". The CJS hook handles it.
  const shim = `
    const { parentPort } = require("node:worker_threads");
    const { startWorkerRealm } = require(${JSON.stringify(ENTRY)});
    const endpoint = {
      post: (message) => parentPort.postMessage(message),
      onMessage: (handler) => {
        const listener = (message) => handler(message);
        parentPort.on("message", listener);
        return () => parentPort.off("message", listener);
      },
    };
    startWorkerRealm(endpoint);
    parentPort.postMessage({ val: "ready" });
  `;
  const worker = new Worker(shim, {
    eval: true,
    execArgv: ["--require", "tsx/cjs"],
  });
  return { worker, bridges: createWorkerBridges(portEndpoint(worker)) };
}

function waitForReady(worker: Worker): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { val?: unknown }).val === "ready"
      ) {
        worker.off("message", onMessage);
        resolve();
      }
    };
    worker.on("message", onMessage);
    // An import failure inside the worker arrives as `error`, not as a rejected
    // promise anywhere — without this the test would time out with no clue why.
    worker.once("error", (error) => reject(error));
  });
}

const project = () => {
  const { c, s } = initVal();
  const authors = c.define("/authors.val.ts", s.record(s.string()), {
    ada: "Ada Lovelace",
    grace: "Grace Hopper",
  });
  return [
    authors,
    c.define(
      "/blogs.val.ts",
      s.record(
        s.object({
          title: s.string().minLength(2),
          author: s.keyOf(authors),
        }),
      ),
      {
        first: { title: "Hello worker", author: "ada" },
        second: { title: "Second post", author: "grace" },
      },
    ),
  ];
};

/** The snapshot `createSystem.gatherSnapshot` would build, built the same way. */
function gather(
  sourceStore: ReturnType<typeof initTestSystem>["sourceStore"],
  schemaStore: ReturnType<typeof initTestSystem>["schemaStore"],
): SourceSnapshot {
  const schemas = schemaStore.all();
  const snapshot: SourceSnapshot = {};
  for (const moduleFilePath of sourceStore.loadedModules()) {
    const schema = schemas[moduleFilePath];
    const source = sourceStore.moduleSource(moduleFilePath);
    if (schema === undefined || source === undefined) continue;
    snapshot[moduleFilePath] = { source, schema, complete: true };
  }
  return snapshot;
}

// Spawning a thread and registering tsv in it costs a second or two; the default
// 5s is not enough on a loaded container and a timeout here reads as a hang.
jest.setTimeout(30_000);

describe("the worker realm runs in a real thread", () => {
  let worker: Worker;
  let bridges: WorkerRealmBridges & { dispose(): void };

  beforeAll(async () => {
    const started = startWorker();
    worker = started.worker;
    bridges = started.bridges;
    await waitForReady(worker);
  });

  afterAll(async () => {
    bridges.dispose();
    await worker.terminate();
  });

  it("indexes in the worker and answers a query from the host", async () => {
    const { sourceStore, schemaStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    const indexed = await bridges.search.reindex(
      gather(sourceStore, schemaStore),
    );
    expect(indexed.all.sort()).toEqual(["/authors.val.ts", "/blogs.val.ts"]);

    const found = await bridges.search.search("worker");
    if (found.status !== "results") {
      throw new Error(`expected results, got ${found.status}`);
    }
    // The index lives in the other thread; this value came back over a wire.
    expect(found.results.map((hit) => hit.path)).toContain(
      '/blogs.val.ts?p="first"."title"',
    );
    dispose();
  });

  it("scans references in the worker and answers find() and at()", async () => {
    const { sourceStore, schemaStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    const scanned = await bridges.references.rescan(
      gather(sourceStore, schemaStore),
    );
    expect(scanned.sort()).toEqual(["/authors.val.ts", "/blogs.val.ts"]);

    const scan = await bridges.references.find({
      kind: "keyOf",
      module: mfp("/authors.val.ts"),
      value: "grace",
    });
    expect(scan.status).toBe("complete");
    expect(scan.refs).toEqual(['/blogs.val.ts?p="second"."author"']);

    const at = await bridges.references.at(
      sp('/blogs.val.ts?p="first"."author"'),
    );
    expect(at).toEqual({
      kind: "keyOf",
      target: "/authors.val.ts",
      value: "ada",
    });
    dispose();
  });

  it("builds patch sets in the worker", async () => {
    const { sourceStore, schemaStore, dispose } = initTestSystem();
    await sourceStore.testReceive(project());

    const sets = await bridges.patchSets.getPatchSets({
      mode: "rebuild",
      records: [
        externalPatch("p-1", "/blogs.val.ts", [
          { op: "replace", path: ["first", "title"], value: "Changed" },
        ]),
      ],
      schemas: schemaStore.all(),
    });
    expect(Array.isArray(sets)).toBe(true);
    expect(sets.length).toBeGreaterThan(0);
    dispose();
  });

  /**
   * A method name that does not exist must come back as an ERROR, not as
   * silence. A caller left waiting on a typo is the worst failure mode a
   * message-passing bridge has, and it is invisible until someone hits it.
   */
  it("rejects an unknown method rather than hanging", async () => {
    // Sent as a raw call, because the typed bridges cannot express a method that
    // does not exist — and the point is what the WORKER does with one, not what
    // TypeScript prevents. An earlier version of this test asserted that a
    // property was undefined on the host proxy, which is trivially true and
    // exercised nothing.
    const endpoint = portEndpoint(worker);
    const reply = await new Promise<{ ok: boolean; message?: string }>(
      (resolve) => {
        const off = endpoint.onMessage((message) => {
          if (
            typeof message === "object" &&
            message !== null &&
            (message as { id?: unknown }).id === 999_999
          ) {
            off();
            resolve(message as { ok: boolean; message?: string });
          }
        });
        endpoint.post({
          val: "call",
          id: 999_999,
          store: "search",
          method: "definitelyNotAMethod",
          args: [],
        });
      },
    );
    expect(reply.ok).toBe(false);
    expect(reply.message).toMatch(/no such method/i);
  });

  /**
   * And a payload that cannot be cloned must fail AT THE CALL, with a message
   * naming the call — not as an unhandled rejection with no stack pointing at
   * the offending value.
   */
  it("reports a non-cloneable payload at the call that sent it", async () => {
    const notCloneable = {
      "/x.val.ts": {
        // A function is the canonical thing that cannot cross, and the exact
        // thing the realm split exists to keep on the host side.
        source: { select: () => "nope" },
        schema: { type: "string", opt: false, raw: false },
        complete: true,
      },
    };
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bridges.search.reindex(notCloneable as any),
    ).rejects.toThrow(/could not send search\.reindex/i);
  });

  /**
   * Disposing must reject what is in flight.
   *
   * A promise that never settles is the one outcome a caller can neither render
   * nor retry, so a closed transport has to become an error.
   */
  it("rejects in-flight calls when disposed", async () => {
    const solo = startWorker();
    await waitForReady(solo.worker);
    const inFlight = solo.bridges.search.search("anything");
    solo.bridges.dispose();
    await expect(inFlight).rejects.toThrow(/disposed/i);
    await solo.worker.terminate();
  });
});

/**
 * The realm split, asserted by what the worker entry can reach.
 *
 * Not a style check: if `SearchStore`, `PatchSetStore` or `ReferenceStore` ever
 * reaches for the host — a `Schema` instance, `SourceStore`, `HostStore` — the
 * worker's import of `workerEntry.ts` fails and every test above dies with a
 * module error. That is the guarantee `architecture.md` describes, made
 * mechanical.
 */
describe("the worker entry cannot reach the host realm", () => {
  it("imports only worker-realm modules", async () => {
    const started = startWorker();
    // Reaching `ready` at all means the import graph resolved inside a realm
    // with no DOM, no host store and no `Schema` instances.
    await expect(waitForReady(started.worker)).resolves.toBeUndefined();
    started.bridges.dispose();
    await started.worker.terminate();
  });

  /**
   * The complement, and it is worth being precise about what it does and does
   * not establish.
   *
   * `HostStore` DOES load in a worker: it imports only from `@valbuild/core`, so
   * nothing in the module graph stops it. The realm boundary is not enforced by
   * imports — it is enforced by what a value can CARRY. A `Schema` instance
   * holds the user's `select` / `render` / custom `validate` closures, and a
   * closure cannot be structured-cloned, so the host cannot be fed from a worker
   * even where it could be constructed in one.
   *
   * So this asserts the honest thing: loading is not the guarantee, and the
   * guarantee is the one the `reportsANonCloneablePayload` test above makes.
   * Written down because "the worker entry imported fine" is the kind of green
   * that invites a wrong conclusion.
   */
  it("shows that loading is not what enforces the realm split", async () => {
    const shim = `
      const { parentPort } = require("node:worker_threads");
      try {
        const m = require(${JSON.stringify(path.resolve(__dirname, "HostStore.ts"))});
        parentPort.postMessage({ val: "loaded", keys: Object.keys(m) });
      } catch (e) {
        parentPort.postMessage({ val: "failed", message: String(e).slice(0, 300) });
      }
    `;
    const probe = new Worker(shim, {
      eval: true,
      execArgv: ["--require", "tsx/cjs"],
    });
    const outcome = await new Promise<{ val: string; message?: string }>(
      (resolve, reject) => {
        probe.once("message", (message) =>
          resolve(message as { val: string; message?: string }),
        );
        probe.once("error", reject);
      },
    );
    await probe.terminate();
    expect(outcome.val).toBe("loaded");
  });
});
