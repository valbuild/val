import { initVal, type ModuleFilePath, type PatchId } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import type { ValOps } from "../ValOps";
import { getHistoricalPatchSet } from "./getHistoricalPatchSet";
import type {
  CommitPatch,
  HistoricalCommit,
  StoredModuleVersion,
} from "./types";

const { s } = initVal();

const MODULE = "/content/landing.val.ts" as ModuleFilePath;
const OTHER = "/content/about.val.ts" as ModuleFilePath;
const COMMIT = "a3f19c2";

const schema = s
  .object({ heading: s.string(), tagline: s.string() })
  ["executeSerialize"]();

function commit(): HistoricalCommit {
  return {
    commitSha: COMMIT,
    parentCommitSha: "p1",
    clientCommitSha: "c1",
    branch: "main",
    createdBranch: null,
    creator: null,
    message: "ship it",
    createdAt: "2026-01-01T00:00:00.000Z",
    seqNum: "4",
    patchCount: 1,
    hasArchive: true,
  };
}

function patch(moduleFilePath: ModuleFilePath, path: string[]): CommitPatch {
  return {
    patchId: "p-1" as PatchId,
    moduleFilePath,
    patch: [{ op: "replace", path, value: "new" }],
    authorId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    baseSha: "b1",
    coreVersion: "0.90.0",
  };
}

/**
 * A ValOps that answers only what this pipeline asks of it.
 *
 * The three history reads are independent of everything else on ValOps, so
 * standing up a real one would be a lot of machinery to exercise none of it.
 */
function opsWith(
  modules: StoredModuleVersion[],
  patches: CommitPatch[],
): ValOps {
  return {
    getCommitPatches: async () => result.ok({ commit: commit(), patches }),
    getCommitModules: async () => result.ok(modules),
    getCommitAffectedFiles: async () => result.ok([]),
  } as unknown as ValOps;
}

function stored(
  moduleFilePath: ModuleFilePath,
  overrides?: Partial<StoredModuleVersion>,
): StoredModuleVersion {
  return {
    moduleFilePath,
    commitSha: COMMIT,
    sourceSha: "s1",
    schemaSha: "h1",
    source: { heading: "Content as code", tagline: "Type-safe content" },
    schema,
    unavailable: false,
    ...overrides,
  };
}

describe("reconstructing a commit", () => {
  test("a module reads back as the data and schema that were stored", async () => {
    // No parse and no replay: the commit recorded what the module IS, so
    // reading it back is a read.
    const res = await getHistoricalPatchSet(
      opsWith([stored(MODULE)], [patch(MODULE, ["heading"])]),
      COMMIT,
    );
    if (result.isErr(res)) throw res.error;
    const module = res.value.modules[MODULE];
    expect(module.source).toEqual({
      heading: "Content as code",
      tagline: "Type-safe content",
    });
    expect(module.schema).toMatchObject({ type: "object" });
    expect(module.failures).toEqual([]);
  });

  test("what the commit changed comes from the ops themselves", async () => {
    const res = await getHistoricalPatchSet(
      opsWith([stored(MODULE)], [patch(MODULE, ["heading"])]),
      COMMIT,
    );
    if (result.isErr(res)) throw res.error;
    expect(res.value.modules[MODULE].changedPaths).toHaveLength(1);
    expect(res.value.modules[MODULE].changedPaths[0]).toContain("heading");
  });

  test("a schema this Val cannot read degrades ONE module, not the commit", async () => {
    // The case the design expects rather than fears: schemas are stored as
    // written and Val's schema format is allowed to move.
    const res = await getHistoricalPatchSet(
      opsWith(
        [
          stored(MODULE, { schema: { type: "from-a-future-val" } }),
          stored(OTHER),
        ],
        [patch(MODULE, ["heading"]), patch(OTHER, ["heading"])],
      ),
      COMMIT,
    );
    if (result.isErr(res)) throw res.error;
    const broken = res.value.modules[MODULE];
    expect(broken.schema).toBe(null);
    expect(broken.failures.map((f) => f.kind)).toEqual(["schema-unreadable"]);
    // The data is still handed over: it is not damaged, it just cannot be
    // rendered here.
    expect(broken.source).not.toBe(null);
    // And the other module is untouched by its neighbour's problem.
    expect(res.value.modules[OTHER].failures).toEqual([]);
    expect(res.value.modules[OTHER].schema).not.toBe(null);
  });

  test("a commit from a Val too old to record modules says so", async () => {
    const res = await getHistoricalPatchSet(
      opsWith([], [patch(MODULE, ["heading"])]),
      COMMIT,
    );
    if (result.isErr(res)) throw res.error;
    expect(res.value.modules[MODULE].failures.map((f) => f.kind)).toEqual([
      "source-unavailable",
    ]);
    // Reported, not defaulted to an empty module — which is the one reading
    // that would be actively wrong.
    expect(res.value.modules[MODULE].source).toBe(null);
  });

  test("holding the hash but not the object is unavailable, not deleted", async () => {
    const res = await getHistoricalPatchSet(
      opsWith(
        [stored(MODULE, { unavailable: true, source: null })],
        [patch(MODULE, ["heading"])],
      ),
      COMMIT,
    );
    if (result.isErr(res)) throw res.error;
    expect(res.value.modules[MODULE].failures.map((f) => f.kind)).toEqual([
      "source-unavailable",
    ]);
  });

  test("a module the commit DELETED is a real answer, with no failure", async () => {
    const res = await getHistoricalPatchSet(
      opsWith([stored(MODULE, { sourceSha: null, source: null })], []),
      COMMIT,
    );
    if (result.isErr(res)) throw res.error;
    expect(res.value.modules[MODULE].source).toBe(null);
    expect(res.value.modules[MODULE].failures).toEqual([]);
  });

  test("a commit that cannot be read at all is an error, not an empty view", async () => {
    const ops = {
      getCommitPatches: async () =>
        result.err({ kind: "commit-not-found", commitSha: COMMIT }),
      getCommitModules: async () => result.ok([]),
      getCommitAffectedFiles: async () => result.ok([]),
    } as unknown as ValOps;
    const res = await getHistoricalPatchSet(ops, COMMIT);
    expect(result.isErr(res)).toBe(true);
  });
});
