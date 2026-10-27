import { initVal, type ModuleFilePath } from "@valbuild/core";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";
import { containsJsonValues, planRevertAll } from "./revertAll";

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
  const MODULE = "/app/support/[slug]/page.val.ts" as ModuleFilePath;
  const schema = s
    .record(s.object({ title: s.string() }))
    .jsonValues()
    ["executeSerialize"]();
  const module = {
    schema,
    source: {
      "/support/faq": { _type: "json", patch_id: "p1" },
      "/support/getting-started": { _type: "json" },
    },
    patchIds: [],
    changedPaths: [],
    failures: [],
  };

  /**
   * A `.jsonValues()` record's entries are NOT in the module's Source. The
   * Source holds `{ _type: "json" }` markers and the content lives in each
   * entry's `*.val.json`, so the recorded Source of such a module is markers,
   * not data. Written back it would put those markers where the content is -
   * which the server now refuses, and which this must not ask it to do.
   *
   * So the plan asks for the CONTENT, naming the keys it needs. The Source is
   * still what says which entries the module had: as a key set it is exact.
   */
  test("asks for the entry content at the commit, naming every key", () => {
    const plan = planRevertAll(patchSet({ [MODULE]: module }));
    expect(plan.modules).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.needsJsonEntries).toEqual([
      {
        moduleFilePath: MODULE,
        entryKeys: ["/support/faq", "/support/getting-started"],
      },
    ]);
  });

  test("with the content, it is one root replace of the whole record", () => {
    // A root replace is all a caller writes. The server fans it out into
    // per-entry ops - an entry added, removed, changed, or left alone - so
    // nothing here has to know that these entries live in their own files.
    const plan = planRevertAll(patchSet({ [MODULE]: module }), {
      [MODULE]: {
        "/support/faq": { title: "FAQ" },
        "/support/getting-started": { title: "Getting started" },
      },
    });
    expect(plan.needsJsonEntries).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.modules).toEqual([
      {
        moduleFilePath: MODULE,
        patch: [
          {
            op: "replace",
            path: [],
            value: {
              "/support/faq": { title: "FAQ" },
              "/support/getting-started": { title: "Getting started" },
            },
          },
        ],
      },
    ]);
  });

  test("content for only SOME of the entries is not enough", () => {
    // The record names every entry it has, so an entry left out of the value is
    // an entry the write deletes. Half the content is not half a revert.
    const plan = planRevertAll(patchSet({ [MODULE]: module }), {
      [MODULE]: {
        "/support/faq": { title: "FAQ" },
      },
    });
    expect(plan.modules).toEqual([]);
    expect(plan.needsJsonEntries).toHaveLength(1);
  });

  test("markers are never what gets written", () => {
    const plan = planRevertAll(patchSet({ [MODULE]: module }), {
      [MODULE]: {
        "/support/faq": { title: "FAQ" },
        "/support/getting-started": { title: "Getting started" },
      },
    });
    expect(JSON.stringify(plan.modules)).not.toContain("_type");
  });
});

/**
 * Which schemas store their values outside the module.
 *
 * `planRevertAll` is not the only thing that puts a module's old value back:
 * "Restore this whole module" does too, and it was added later. Both ask
 * `planModuleRevert`, so the rule about what a jsonValues module's value IS
 * cannot end up applying to one of them and not the other — which is exactly
 * how a guard comes to be half true.
 */
describe("which schemas hold entries stored outside the module", () => {
  test("a `.jsonValues()` record does", () => {
    expect(
      containsJsonValues(
        s
          .record(s.object({ title: s.string() }))
          .jsonValues()
          ["executeSerialize"](),
      ),
    ).toBe(true);
  });

  test("so does one nested inside an object", () => {
    expect(
      containsJsonValues(
        s
          .object({
            pages: s.record(s.object({ title: s.string() })).jsonValues(),
          })
          ["executeSerialize"](),
      ),
    ).toBe(true);
  });

  test("an ordinary record does not", () => {
    expect(
      containsJsonValues(
        s.record(s.object({ title: s.string() }))["executeSerialize"](),
      ),
    ).toBe(false);
  });
});
