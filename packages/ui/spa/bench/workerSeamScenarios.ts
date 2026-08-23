import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";
import { createSystem, type System } from "../stores/createSystem";
import { createWorkerBridges, domEndpoint } from "../stores/workerBridge";
import { generateProject, SIZES, type ProjectSize } from "./generateProject";

/**
 * # Is the worker realm worth moving to a worker?
 *
 * `workerBridge.test.ts` establishes that the three worker-realm stores CAN run
 * in another thread. That is a different question from whether they should, and
 * `openquestions.md` item 5 says so explicitly: nothing moves to a worker before
 * the number exists.
 *
 * ## What a worker actually trades
 *
 * A worker buys exactly one thing — the compute stops occupying the main thread,
 * so it cannot delay a keystroke — and pays for it with:
 *
 * 1. **A structured clone of the arguments**, paid SYNCHRONOUSLY on the main
 *    thread inside `postMessage`. This is the cost that matters, because it is
 *    the part a worker cannot move: it is main-thread blocking that only exists
 *    because there is a worker.
 * 2. **A clone of the result**, on the way back.
 * 3. **Round-trip scheduling**, which turns a sub-millisecond call into a
 *    minimum of one task hop each way.
 *
 * So the trade is good exactly when the compute is large and the payload is
 * small, and bad when the payload is large or the call is small and frequent.
 * Which is why this is measured per OPERATION rather than per store: one store
 * can have both kinds.
 *
 * ## The two numbers
 *
 * - **`totalMs`** — wall clock from asking to having the answer. A worker is
 *   expected to LOSE here, always: it does the same work plus two clones plus
 *   scheduling. A run where the worker wins total time is a run to distrust.
 * - **`maxDelayMs`** — the longest a macrotask queued behind the operation had
 *   to wait before it could run, from a `MessageChannel` ticker. That IS the
 *   latency a keystroke arriving mid-operation would suffer, and it is what a
 *   worker exists to improve: total time can be paid after the character
 *   appears, a 40 ms unavailable main thread cannot.
 *
 * Reading only `totalMs` would conclude "never use a worker"; reading only
 * `maxDelayMs` would conclude "always use one". The decision is the pair.
 *
 * ## What this cannot see
 *
 * The generated project has no `keyOf`, no `route` and no file fields, so the
 * reference INDEX comes out empty. The scan still walks every module — that is
 * the cost being measured — but `find` and `at` return nothing, so their rows
 * measure round-trip latency and not index lookup. That is the honest reading and
 * it happens to be the number the "small frequent queries lose" hypothesis is
 * about; a row that found 300 referrers would measure something else.
 *
 * `examples/next` does have those shapes. Pointing the benchmark at it is listed
 * in `README.md` as not done, and it stays not done here rather than being half
 * done in a way that changes the other tables' numbers.
 */

export type SeamRealm = "in-process" | "worker";

export type SeamSample = {
  totalMs: number;
  /** Longest a task queued behind this operation waited to run. */
  maxDelayMs: number;
  /** Macrotasks that got to run during the region. Zero = it never yielded. */
  ticks: number;
  /** Bytes of JSON handed across, so a clone cost is attributable. */
  payloadBytes: number;
  /** Proof the operation did something: what it returned, counted. */
  answered: number;
};

export type SeamResult = {
  op: string;
  note: string;
  realm: SeamRealm;
  size: string;
  samples: SeamSample[];
};

const now = () => performance.now();

/**
 * How long does a task queued behind this operation have to wait?
 *
 * A `MessageChannel` ping-pong is the cheapest way to schedule a macrotask
 * repeatedly without `setTimeout`'s 4 ms clamp. Each tick records the delay from
 * when it was posted to when it ran, which is exactly the latency a keystroke
 * arriving at that moment would suffer.
 *
 * The first version of this measured the GAP BETWEEN TICKS and reported 0.00 ms
 * for a 121 ms synchronous index build. The reason is the thing being measured:
 * a fully synchronous region never yields, so not one tick ever ran, so there
 * were no gaps — and "no gaps" came out as "no blocking", the exact opposite of
 * the truth. The fix is the `outstanding` reading in `stop`: the tick still
 * sitting in the queue when the region ended is the one that waited longest.
 *
 * `ticks` is returned for the same reason. Zero ticks means the main thread never
 * yielded once, which is a different and worse thing than a small delay, and the
 * report marks it.
 */
function startBlockProbe(): {
  stop(): { maxDelayMs: number; ticks: number };
} {
  const channel = new MessageChannel();
  let postedAt = now();
  let maxDelayMs = 0;
  let ticks = 0;
  let running = true;
  channel.port1.onmessage = () => {
    const at = now();
    const delay = at - postedAt;
    if (delay > maxDelayMs) {
      maxDelayMs = delay;
    }
    ticks++;
    if (running) {
      postedAt = at;
      channel.port2.postMessage(0);
    }
  };
  channel.port2.postMessage(0);
  return {
    stop() {
      running = false;
      const outstanding = now() - postedAt;
      if (outstanding > maxDelayMs) {
        maxDelayMs = outstanding;
      }
      channel.port1.close();
      channel.port2.close();
      return { maxDelayMs, ticks };
    },
  };
}

/** The probe's own resolution, over an idle region of the same order. */
export async function measureProbeFloor(): Promise<number> {
  const probe = startBlockProbe();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return probe.stop().maxDelayMs;
}

/** Where the worker script is served. Set by the runner; a default for a page. */
function workerUrl(): string {
  const configured: unknown = (globalThis as { valBenchWorkerUrl?: unknown })
    .valBenchWorkerUrl;
  return typeof configured === "string" ? configured : "/worker.js";
}

type Realm = {
  system: System;
  dispose(): void;
};

function makeSystem(realm: SeamRealm): Realm {
  const refuse = () => {
    throw new Error("The worker-seam benchmark took a network path.");
  };
  if (realm === "in-process") {
    const system = createSystem({ fetchPatches: refuse });
    return { system, dispose: () => system.dispose() };
  }
  const worker = new Worker(workerUrl());
  const bridges = createWorkerBridges(domEndpoint(worker));
  const system = createSystem({
    fetchPatches: refuse,
    workerRealm: bridges,
  });
  return {
    system,
    dispose() {
      system.dispose();
      bridges.dispose();
      worker.terminate();
    },
  };
}

/**
 * The size of the whole-project snapshot, reconstructed.
 *
 * `createSystem`'s `gatherSnapshot` is private and should stay so — it is an
 * implementation detail of the system, not an API. Rebuilding the same shape from
 * the two public readers it uses gives the same bytes without widening anything,
 * and if the two ever drift this number becomes wrong rather than the benchmark
 * becoming impossible to write, which is the right way round.
 */
function snapshotBytes(system: System): number {
  const schemas = system.schemaStore.all();
  const snapshot: Record<
    ModuleFilePath,
    { source: Json; schema: SerializedSchema; complete: boolean }
  > = {};
  for (const moduleFilePath of system.sourceStore.loadedModules()) {
    const schema = schemas[moduleFilePath];
    const source = system.sourceStore.moduleSource(moduleFilePath);
    if (schema === undefined || source === undefined) continue;
    snapshot[moduleFilePath] = { source, schema, complete: true };
  }
  return JSON.stringify(snapshot).length;
}

function patchSetPayloadBytes(system: System): number {
  return JSON.stringify({
    records: system.patchStore.allRecords(),
    schemas: system.schemaStore.all(),
  }).length;
}

/**
 * One operation, measured.
 *
 * Every op prepares OUTSIDE the timed region and then times exactly one call.
 * The whole point of the exercise is a per-call number, so an op that timed its
 * own setup would report the setup.
 */
type SeamOp = {
  name: string;
  note: string;
  measure(
    realm: Realm,
    project: ReturnType<typeof generateProject>,
  ): Promise<SeamSample>;
};

async function timed(
  payloadBytes: number,
  call: () => Promise<number>,
): Promise<SeamSample> {
  const probe = startBlockProbe();
  const start = now();
  const answered = await call();
  const totalMs = now() - start;
  const { maxDelayMs, ticks } = probe.stop();
  return { totalMs, maxDelayMs, ticks, payloadBytes, answered };
}

export const SEAM_OPS: SeamOp[] = [
  {
    name: "search:index",
    note: "first index build: the whole project crosses",
    async measure(realm) {
      const bytes = snapshotBytes(realm.system);
      return timed(bytes, async () => {
        const built = await realm.system.buildSearchIndex();
        return built.all.length;
      });
    },
  },
  {
    name: "search:query",
    note: "a query against a built index: nothing to gather",
    async measure(realm) {
      await realm.system.buildSearchIndex();
      return timed(0, async () => {
        const found = await realm.system.search("row 3", 20);
        return found.status === "results" ? found.results.length : 0;
      });
    },
  },
  {
    name: "search:reindex",
    note: "one module edited, then a query: the incremental pass",
    async measure(realm, project) {
      await realm.system.buildSearchIndex();
      await realm.system.patchStore.createPatch(
        project.typedModule as ModuleFilePath,
        [
          {
            op: "replace",
            path: patchPathOf(project.typedFieldPath),
            value: "edited for the reindex measurement",
          },
        ],
        undefined,
        "seam-field",
      );
      // One module's worth, not the project's: `StaleModules.target` scopes it.
      // Measured rather than asserted, because "scoped" is a claim about bytes.
      const schemas = realm.system.schemaStore.all();
      const one = {
        source: realm.system.sourceStore.moduleSource(
          project.typedModule as ModuleFilePath,
        ),
        schema: schemas[project.typedModule as ModuleFilePath],
        complete: true,
      };
      return timed(
        JSON.stringify({ [project.typedModule]: one }).length,
        async () => {
          const found = await realm.system.search("row 3", 20);
          return found.status === "results" ? found.results.length : 0;
        },
      );
    },
  },
  {
    name: "patchSets",
    note: "the grouping: patch records AND every schema cross, per call",
    async measure(realm, project) {
      await realm.system.patchStore.createPatch(
        project.typedModule as ModuleFilePath,
        [
          {
            op: "replace",
            path: patchPathOf(project.typedFieldPath),
            value: "edited for the patch-set measurement",
          },
        ],
        undefined,
        "seam-field",
      );
      const bytes = patchSetPayloadBytes(realm.system);
      return timed(bytes, async () => {
        const sets = await realm.system.getPatchSets();
        return Object.keys(sets).length;
      });
    },
  },
  {
    name: "refs:rescan",
    note: "first reference query: the whole project is walked",
    async measure(realm) {
      const bytes = snapshotBytes(realm.system);
      return timed(bytes, async () => {
        const scan = await realm.system.findReferences({ kind: "route" });
        return scan.refs.length;
      });
    },
  },
  {
    name: "refs:find",
    note: "a second query, index warm: the small frequent case",
    async measure(realm) {
      await realm.system.findReferences({ kind: "route" });
      return timed(0, async () => {
        const scan = await realm.system.findReferences({ kind: "route" });
        return scan.refs.length;
      });
    },
  },
  {
    name: "refs:at",
    note: "what one field points at: the smallest call there is",
    async measure(realm, project) {
      await realm.system.findReferences({ kind: "route" });
      return timed(0, async () => {
        const at = await realm.system.referenceAt(
          project.typedFieldPath as SourcePath,
        );
        return at === null ? 0 : 1;
      });
    },
  },
];

/** As `drivers.ts` does it, and for the same reason: quoted, dot-joined paths. */
function patchPathOf(path: string): string[] {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    path as SourcePath,
  );
  return modulePath === ""
    ? []
    : Internal.splitModulePath(modulePath).map(String);
}

export const SEAM_REALMS: SeamRealm[] = ["in-process", "worker"];

/**
 * Run every op in both realms.
 *
 * A fresh project, a fresh system and a FRESH WORKER per repetition. Reusing the
 * worker would hide the one cost a shipped Studio pays once — spinning it up —
 * and would let the previous repetition's index answer this one's query, which
 * for an operation whose whole question is "did it have to gather" is not a wash.
 */
export async function runSeam(
  repetitions = 5,
  sizeNames: string[] = Object.keys(SIZES),
): Promise<SeamResult[]> {
  const results: SeamResult[] = [];
  for (const sizeName of sizeNames) {
    const size: ProjectSize = SIZES[sizeName];
    for (const op of SEAM_OPS) {
      for (const realmName of SEAM_REALMS) {
        const samples: SeamSample[] = [];
        for (let rep = 0; rep <= repetitions; rep++) {
          const project = generateProject(size);
          const realm = makeSystem(realmName);
          // The worker's first message waits for the other thread to boot and
          // instantiate its modules, which is a one-time cost no operation
          // should be charged for.
          //
          // It has to be warmed with something INERT, and the first version of
          // this got that wrong: it used `referenceAt`, which scans the whole
          // project before answering. So `refs:rescan` was measured against an
          // index that was already built, and reported the worker doing a
          // whole-project walk 4x FASTER than in-process — which is impossible,
          // and was the tell. `forget` on a module that does not exist is a real
          // round trip that changes no state, and it happens BEFORE `receive`,
          // so there is nothing it could have warmed even by accident.
          if (realmName === "worker") {
            await realm.system.searchStore.forget(
              "/does-not-exist.val.ts" as ModuleFilePath,
            );
          }
          realm.system.host.receive(project.modules);
          const sample = await op.measure(realm, project);
          realm.dispose();
          if (rep > 0) samples.push(sample);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        results.push({
          op: op.name,
          note: op.note,
          realm: realmName,
          size: sizeName,
          samples,
        });
      }
    }
  }
  return results;
}
