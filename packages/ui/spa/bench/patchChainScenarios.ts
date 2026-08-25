import { Internal, type ModuleFilePath, type SourcePath } from "@valbuild/core";
import { createSystem, type System } from "../stores/createSystem";
import { generateProject, SIZES, type ProjectSize } from "./generateProject";

/**
 * # What does a deep patch chain cost the NEXT edit?
 *
 * Applying 10,000 pending patches is slow, and that is fine: it happens once,
 * when a session adopts a chain the server already had. The question this table
 * answers is the one that decides whether the system is usable at that depth —
 * **once the chain is deep, is the next patch still cheap?**
 *
 * Four reads are timed after that next patch, because they are the four things
 * that could plausibly have been made O(chain):
 *
 * - **source** — reading the value at one path
 * - **validation** — validating the module the patch touched
 * - **search** — one query
 * - **patch sets** — grouping the chain for the review UI
 *
 * A flat column across depths means the cost is in the EDIT, not in the history
 * behind it. A column that climbs with depth is a design defect at scale, and the
 * shape of the climb says which one: linear in depth means something re-walks the
 * chain per read, and a step change at one depth usually means a cache stopped
 * fitting.
 *
 * ## Why each read is warmed first
 *
 * Every read here is taken as a MARGINAL cost, and that takes a warm-up call
 * before the measured one. Without it the numbers would be dominated by
 * first-time work that has nothing to do with chain depth:
 *
 * - `system.search` builds the index on the first query. Measuring that would
 *   report the cost of indexing the project, once, as though it were the cost of
 *   searching after an edit. Warmed, it reports what it should: reindex the ONE
 *   module the patch touched, then query.
 * - `system.getPatchSets` plans against `PatchSetChain`, whose whole point is a
 *   prefix test — an append is cheap, a rebuild is not. Measuring the first call
 *   at depth 10,000 would measure the rebuild. Warmed, it measures the append,
 *   which is what a keystroke actually triggers.
 *
 * So `buildMs` is the honest home for the one-time costs, and the four read
 * columns are honest about being marginal. Both are reported: a reader who wants
 * to know what adopting a 10,000-patch chain costs should look at `buildMs` and
 * not be told a warm number instead.
 *
 * ## Small against big patches
 *
 * The same depths are run twice, with a small value and a ~2 KB one, because the
 * two scale differently and only one of them is about the chain. Depth multiplies
 * the number of records; payload multiplies the bytes each record carries and the
 * size of the source they are applied into. If the big-payload column climbs
 * where the small one is flat, the cost is in copying values rather than in
 * traversing history.
 *
 * ## The chain is SPREAD across the project, not piled on one field
 *
 * Every patch in the chain targets a different field, cycling through the
 * project's plain modules. Piling all N onto one path was the first shape of this
 * and it made one of the four columns measure nothing: `PatchSets` groups by
 * path, so 10,000 edits to one field is ONE patch set, and the grouping had
 * nothing to traverse however deep the chain got.
 *
 * Spreading is also the more honest picture of a deep chain. A chain is deep
 * because a lot of the site was edited before anyone published, not because one
 * person held a key down — and `sets` in the output shows the difference: it now
 * grows with depth, so the patch-set column is doing work.
 *
 * ## What this cannot see
 *
 * No server. `createPatch` is the local-edit path, so `buildMs` is N creates plus
 * N applies — close to what adopting a chain costs, but not the same code:
 * a real adoption receives records over `/patches`. Nothing here measures the
 * network, the same limitation the other tables carry.
 */

/** Chain depths. 10,000 is the "surely not" case, run because it is cheap to. */
export const CHAIN_DEPTHS = [1, 10, 100, 1000, 10000];

/**
 * ~2 KB, which is a paragraph of rich text rather than a pathological blob.
 * The interesting question is whether payload size interacts with DEPTH, and a
 * value big enough to dominate its own row would answer a different one.
 */
const BIG_VALUE = "x".repeat(2048);

export type PatchPayload = "small" | "big";

export type ChainSample = {
  /** Building the chain: N creates and N applies. The once-per-session cost. */
  buildMs: number;
  /** The next patch after the chain is that deep. */
  nextPatchMs: number;
  /** Source at one path, after that patch. */
  sourceMs: number;
  /** Validating the module that patch touched. */
  validateMs: number;
  /** One search query. Warm index. */
  searchMs: number;
  /** Grouping the chain. Warm chain. */
  patchSetsMs: number;
  /** Proof the chain is as deep as the row claims. */
  chainLength: number;
  /** Proof the reads answered rather than short-circuiting. */
  sourceResolved: boolean;
  searchHits: number;
  patchSetCount: number;
};

export type ChainResult = {
  depth: number;
  payload: PatchPayload;
  size: string;
  samples: ChainSample[];
};

const now = () => performance.now();

/**
 * A fresh system per repetition, as everywhere else here: a shared one would let
 * the previous repetition's caches serve this one, and caches are exactly what is
 * under test.
 */
function makeSystem(): System {
  return createSystem({
    fetchPatches: async () => {
      throw new Error(
        "The benchmark took a network path it should not have: GET /patches.",
      );
    },
    createPatchId: (() => {
      let next = 0;
      return () => `chain-${++next}` as never;
    })(),
  });
}

function patchPathOf(path: string): string[] {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    path as SourcePath,
  );
  return modulePath === ""
    ? []
    : Internal.splitModulePath(modulePath).map(String);
}

async function runOne(
  depth: number,
  payload: PatchPayload,
  size: ProjectSize,
): Promise<ChainSample> {
  const project = generateProject(size);
  const system = makeSystem();
  system.host.receive(project.modules);

  const moduleFilePath = project.typedModule as ModuleFilePath;
  const fieldPath = project.typedFieldPath;
  const opPath = patchPathOf(fieldPath);
  const value = (n: number) =>
    payload === "big" ? `${n}-${BIG_VALUE}` : `edit ${n}`;

  /**
   * Where the i-th patch in the chain goes: a different field each time, cycling
   * through the project.
   *
   * `mountedPaths` is used as the source of targets because every entry is a real
   * leaf path in a plain module, which is what a patch op needs. It is shorter
   * than the project is wide, so deep chains wrap and re-edit — which is what a
   * real chain does too.
   */
  const targets = project.mountedPaths;
  const targetAt = (i: number) => {
    const path = targets[i % targets.length];
    return {
      module: path.split("?p=")[0] as ModuleFilePath,
      op: patchPathOf(path),
    };
  };

  // A field is listening, so notification and per-instance suppression are
  // exercised rather than bypassed. A chain built with nobody looking would not
  // be the chain a real session has.
  const off = system.sourceStore.addListener(
    fieldPath as SourcePath,
    "chain-field-0",
    () => {},
  );

  const buildStart = now();
  for (let i = 0; i < depth; i++) {
    const target = targetAt(i);
    await system.patchStore.createPatch(
      target.module,
      [{ op: "replace", path: target.op, value: value(i) }],
      undefined,
      "chain-field-0",
    );
  }
  const buildMs = now() - buildStart;

  // Warm each read, so what follows is a marginal cost and not a first-time one.
  // See the note at the top: this is the difference between measuring "search
  // after an edit" and "indexing the project".
  await system.sourceStore.get(fieldPath as SourcePath, null);
  await system.validationStore.validate(moduleFilePath);
  await system.search("page", 10);
  await system.getPatchSets();

  const nextStart = now();
  await system.patchStore.createPatch(
    moduleFilePath,
    [{ op: "replace", path: opPath, value: value(depth) }],
    undefined,
    "chain-field-0",
  );
  const nextPatchMs = now() - nextStart;

  const sourceStart = now();
  const read = await system.sourceStore.get(fieldPath as SourcePath, null);
  const sourceMs = now() - sourceStart;

  const validateStart = now();
  await system.validationStore.validate(moduleFilePath);
  const validateMs = now() - validateStart;

  const searchStart = now();
  const found = await system.search("page", 10);
  const searchMs = now() - searchStart;

  const patchSetsStart = now();
  const sets = await system.getPatchSets();
  const patchSetsMs = now() - patchSetsStart;

  const chainLength = system.patchStore.allRecords().length;
  off();
  system.dispose();

  return {
    buildMs,
    nextPatchMs,
    sourceMs,
    validateMs,
    searchMs,
    patchSetsMs,
    chainLength,
    sourceResolved:
      read.status === "resolved-head" || read.status === "unchanged",
    searchHits: found.status === "no-index" ? 0 : found.results.length,
    patchSetCount: sets.length,
  };
}

export async function runPatchChain(
  repetitions = 3,
  depths: number[] = CHAIN_DEPTHS,
  payloads: PatchPayload[] = ["small", "big"],
  sizeName = "small",
): Promise<ChainResult[]> {
  const size = SIZES[sizeName];
  const results: ChainResult[] = [];
  for (const payload of payloads) {
    for (const depth of depths) {
      const samples: ChainSample[] = [];
      // One extra, discarded: the first repetition pays for JIT warm-up that has
      // nothing to do with the row.
      for (let rep = 0; rep <= repetitions; rep++) {
        const sample = await runOne(depth, payload, size);
        if (rep > 0) samples.push(sample);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      results.push({ depth, payload, size: sizeName, samples });
    }
  }
  return results;
}
