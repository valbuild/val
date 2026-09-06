import { initVal } from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { planRevertAll } from "./revertAll";

const { s } = initVal();

function patchSet(modules: HistoricalPatchSet["modules"]): HistoricalPatchSet {
  return {
    commit: {
      commitSha: "a3f19c2",
      parentCommitSha: "p",
      clientCommitSha: "c",
      branch: "main",
      createdBranch: null,
      creator: null,
      message: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      seqNum: "1",
      patchCount: 1,
      hasArchive: true,
    },
    modules,
    patches: [],
    jsonEntries: {},
    binaryFiles: [],
    warnings: [],
  };
}

describe("reverting a `.jsonValues()` module", () => {
  /**
   * A `.jsonValues()` record's entries are NOT in the module's Source. The
   * Source holds `{ _type: "json" }` markers and the content lives in each
   * entry's `*.val.json`, so the recorded Source of such a module is markers,
   * not data. A root `replace` with it would write those markers into the
   * `.val.ts` over the `c.json(() => import(...))` calls — and the server routes
   * a root op as a plain source edit (`classifyJsonValuesOp` never sees a
   * jsonValues record at an empty path), so nothing downstream would catch it.
   *
   * The plan therefore has to leave such a module out and say why, the same
   * way it leaves out a module with no recorded content.
   */
  test("is blocked rather than written as markers over the entry imports", () => {
    const schema = s
      .record(s.object({ title: s.string() }))
      .jsonValues()
      ["executeSerialize"]();
    const plan = planRevertAll(
      patchSet({
        "/app/support/[slug]/page.val.ts": {
          schema,
          source: {
            "/support/faq": { _type: "json", patch_id: "p1" },
            "/support/getting-started": { _type: "json" },
          },
          patchIds: [],
          changedPaths: [],
          failures: [],
        },
      }),
    );
    expect(plan.modules).toEqual([]);
    expect(plan.blocked).toHaveLength(1);
  });
});
