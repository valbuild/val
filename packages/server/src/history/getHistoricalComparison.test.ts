import { initVal, type ModuleFilePath } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import type { Patch } from "@valbuild/core/patch";
import { getHistoricalComparison } from "./getHistoricalComparison";
import { getHistoricalPatchSet } from "./getHistoricalPatchSet";
import type { ValOps, Schemas, Sources } from "../ValOps";
import type { AffectedFile, CommitPatch, HistoricalCommit } from "./types";

const { s } = initVal();
const path = "/content/page.val.ts" as ModuleFilePath;
const commitSha = "abc123";

const moduleText = (title: string, count: number) =>
  `import { c, s } from "../val.config";
export default c.define(
  "/content/page.val.ts",
  s.object({ title: s.string(), count: s.number() }),
  { title: ${JSON.stringify(title)}, count: ${count} },
);`;

const commit: HistoricalCommit = {
  commitSha,
  parentCommitSha: "parent1",
  clientCommitSha: "client1",
  branch: "main",
  createdBranch: null,
  creator: "profile1",
  message: "Change the title",
  createdAt: "2026-01-01T00:00:00.000Z",
  seqNum: "1",
  patchCount: 1,
  hasArchive: true,
};

/**
 * A ValOps whose history comes from the arguments, and whose schema and source
 * checks are the REAL ones - so these exercise the actual pipeline rather than
 * a mock of it.
 */
function fakeOps(args: {
  patches?: CommitPatch[];
  previousSourceFiles?: Record<string, string>;
  affectedFiles?: AffectedFile[];
  schemas?: Schemas;
  currentSources?: Sources;
  fileAtCommit?: (filePath: string) => Buffer | null;
}): ValOps {
  const { ValOps: ValOpsClass } =
    jest.requireActual<typeof import("../ValOps")>("../ValOps");
  const ops = Object.create(ValOpsClass.prototype) as ValOps;
  const define = (name: string, value: unknown) =>
    Object.defineProperty(ops, name, { value, configurable: true });

  define("getCommitPatches", async () =>
    result.ok({ commit, patches: args.patches ?? [] }),
  );
  define("getCommitPreviousSources", async () =>
    result.ok(args.previousSourceFiles ?? {}),
  );
  define("getCommitAffectedFiles", async () =>
    result.ok(args.affectedFiles ?? []),
  );
  define("getFileAtCommit", async (_sha: string, filePath: string) => {
    const bytes = args.fileAtCommit?.(filePath);
    return bytes
      ? result.ok(bytes)
      : result.err({
          kind: "file-unavailable",
          gitPath: filePath,
          message: "404",
        });
  });
  define("getSchemas", async () => args.schemas ?? {});
  define("getSources", async () => ({ sources: args.currentSources ?? {} }));
  return ops;
}

const patch = (
  patchId: string,
  ops: Patch,
  coreVersion = "1.0.0",
): CommitPatch => ({
  patchId: patchId as never,
  moduleFilePath: path,
  patch: ops,
  authorId: "profile1",
  createdAt: "2026-01-01T00:00:00.000Z",
  baseSha: "base1",
  coreVersion,
});

function unwrap<T>(res: result.Result<T, unknown>): T {
  if (result.isErr(res)) {
    throw new Error(`expected ok, got ${JSON.stringify(res.error)}`);
  }
  return res.value;
}

describe("getHistoricalPatchSet", () => {
  test("reconstructs before, after, and what the commit changed", async () => {
    const ops = fakeOps({
      previousSourceFiles: { [path]: moduleText("old", 1) },
      patches: [
        patch("p1", [{ op: "replace", path: ["title"], value: "new" }]),
      ],
    });
    const res = unwrap(await getHistoricalPatchSet(ops, commitSha));
    expect(res.modules[path].before).toEqual({ title: "old", count: 1 });
    expect(res.modules[path].after).toEqual({ title: "new", count: 1 });
    expect(res.modules[path].changedPaths).toEqual([
      '/content/page.val.ts?p="title"',
    ]);
    expect(res.modules[path].failures).toEqual([]);
  });

  // A commit made by a client too old to send its sources. Must be reported,
  // not silently read as "the module was empty".
  test("reports a module with no stored source", async () => {
    const ops = fakeOps({
      previousSourceFiles: {},
      patches: [
        patch("p1", [{ op: "replace", path: ["title"], value: "new" }]),
      ],
    });
    const res = unwrap(await getHistoricalPatchSet(ops, commitSha));
    expect(res.modules[path].before).toBeNull();
    expect(res.modules[path].failures[0]).toMatchObject({
      kind: "source-unavailable",
    });
  });

  // Binary files are NAMED, never fetched - showing that a commit changed six
  // images must not download six images.
  test("describes binary files without fetching them", async () => {
    const fileAtCommit = jest.fn(() => null);
    const ops = fakeOps({
      previousSourceFiles: { [path]: moduleText("a", 1) },
      affectedFiles: [
        { kind: "binary", gitPath: "public/val/a_1b2c3.png", change: "added" },
      ],
      fileAtCommit,
    });
    const res = unwrap(await getHistoricalPatchSet(ops, commitSha));
    expect(res.binaryFiles).toHaveLength(1);
    expect(res.binaryFiles[0].url).toContain("commit_sha=abc123");
    expect(fileAtCommit).not.toHaveBeenCalled();
  });

  test("a commit that cannot be read at all is an error", async () => {
    const ops = fakeOps({});
    Object.defineProperty(ops, "getCommitPatches", {
      value: async () => result.err({ kind: "commit-not-found", commitSha }),
      configurable: true,
    });
    const res = await getHistoricalPatchSet(ops, commitSha);
    expect(result.isErr(res)).toBe(true);
  });
});

describe("getHistoricalComparison", () => {
  test("says what a restore would undo, and allows it", async () => {
    const ops = fakeOps({
      previousSourceFiles: { [path]: moduleText("old", 1) },
      patches: [
        patch("p1", [{ op: "replace", path: ["title"], value: "new" }]),
      ],
      schemas: { [path]: s.object({ title: s.string(), count: s.number() }) },
      // Someone has since changed the title again.
      currentSources: { [path]: { title: "newest", count: 1 } },
    });
    const res = unwrap(await getHistoricalComparison(ops, commitSha));
    expect(res.modules[path].current).toEqual({ title: "newest", count: 1 });
    expect(res.modules[path].changedVsCurrent).toEqual([
      '/content/page.val.ts?p="title"',
    ]);
    expect(res.modules[path].verdict).toEqual({ status: "restorable" });
  });

  // The case the user asked for: the schema moved on, so the old value cannot
  // go back.
  test("blocks a restore when the schema has changed under it", async () => {
    const ops = fakeOps({
      previousSourceFiles: { [path]: moduleText("old", 1) },
      patches: [
        patch("p1", [{ op: "replace", path: ["title"], value: "new" }]),
      ],
      // `count` is a string now.
      schemas: { [path]: s.object({ title: s.string(), count: s.string() }) },
      currentSources: { [path]: { title: "newest", count: "1" } },
    });
    const res = unwrap(await getHistoricalComparison(ops, commitSha));
    const verdict = res.modules[path].verdict;
    expect(verdict.status).toBe("blocked");
    if (verdict.status === "blocked") {
      expect(verdict.reasons.map((r) => r.kind)).toContain("schema-mismatch");
    }
  });

  test("blocks a restore into a module that no longer exists", async () => {
    const ops = fakeOps({
      previousSourceFiles: { [path]: moduleText("old", 1) },
      patches: [
        patch("p1", [{ op: "replace", path: ["title"], value: "new" }]),
      ],
      schemas: {},
      currentSources: {},
    });
    const res = unwrap(await getHistoricalComparison(ops, commitSha));
    const verdict = res.modules[path].verdict;
    expect(verdict.status).toBe("blocked");
    if (verdict.status === "blocked") {
      expect(verdict.reasons.map((r) => r.kind)).toContain("module-removed");
    }
  });

  // Broken ops mean there is no trustworthy source to restore FROM.
  test("blocks a restore when a patch would not replay", async () => {
    const ops = fakeOps({
      previousSourceFiles: { [path]: moduleText("old", 1) },
      patches: [
        patch("p1", [{ op: "replace", path: ["nope", "deep"], value: "x" }]),
      ],
      schemas: { [path]: s.object({ title: s.string(), count: s.number() }) },
      currentSources: { [path]: { title: "old", count: 1 } },
    });
    const res = unwrap(await getHistoricalComparison(ops, commitSha));
    const verdict = res.modules[path].verdict;
    expect(verdict.status).toBe("blocked");
    if (verdict.status === "blocked") {
      expect(verdict.reasons.map((r) => r.kind)).toContain(
        "patch-not-applicable",
      );
    }
  });
});
