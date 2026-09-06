import { initVal, type SourcePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { buildRestorePatch, collectMediaPaths } from "./stageRestore";
import { planRevertAll } from "./revertAll";
import type { HistoricalPatchSet } from "@valbuild/shared/internal";

const { s } = initVal();
const MODULE = "/content/landing.val.ts";

describe("building a restore", () => {
  test("a restore is one replace at the place someone pointed", () => {
    // Deliberately not a computed diff: the earlier design inferred which of
    // today's array items matched which of the commit's, and array items
    // splice — so the inference could write into the wrong row and look fine.
    const patch = buildRestorePatch(
      `${MODULE}?p=%22heading%22` as SourcePath,
      "Content as code",
    );
    expect(patch).toHaveLength(1);
    expect(patch[0].op).toBe("replace");
    expect("value" in patch[0] && patch[0].value).toBe("Content as code");
  });
});

describe("finding the media a restored value carries", () => {
  test("media is found through the SCHEMA, not by shape", () => {
    // Nothing decides "this is media" by looking at the value. Guessing from
    // the value would pick up any object that happens to have a `path`.
    const schema = s
      .object({ hero: s.image(), caption: s.string() })
      ["executeSerialize"]();
    const value: JSONValue = {
      hero: { path: "/public/val/hero_a1b2c.png", width: 10, height: 10 },
      caption: "A caption",
    };
    expect(collectMediaPaths(schema, value)).toEqual([
      "/public/val/hero_a1b2c.png",
    ]);
  });

  test("an object that merely has a `path` is not media", () => {
    const schema = s
      .object({ link: s.object({ path: s.string() }) })
      ["executeSerialize"]();
    const value: JSONValue = { link: { path: "/not-a-file" } };
    expect(collectMediaPaths(schema, value)).toEqual([]);
  });

  test("media nested in arrays and records is found", () => {
    const schema = s
      .object({ gallery: s.array(s.object({ img: s.image() })) })
      ["executeSerialize"]();
    const value: JSONValue = {
      gallery: [
        { img: { path: "/public/val/a.png" } },
        { img: { path: "/public/val/b.png" } },
      ],
    };
    expect(collectMediaPaths(schema, value)).toEqual([
      "/public/val/a.png",
      "/public/val/b.png",
    ]);
  });

  test("the same file referenced twice is uploaded once", () => {
    const schema = s
      .object({ a: s.image(), b: s.image() })
      ["executeSerialize"]();
    const value: JSONValue = {
      a: { path: "/public/val/same.png" },
      b: { path: "/public/val/same.png" },
    };
    expect(collectMediaPaths(schema, value)).toEqual(["/public/val/same.png"]);
  });
});

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

describe("reverting everything", () => {
  const ok = {
    source: { heading: "Content as code" },
    schema: s.object({ heading: s.string() })["executeSerialize"](),
    patchIds: [],
    changedPaths: [],
    failures: [],
  };

  test("one patch per module, each replacing the module wholesale", () => {
    const plan = planRevertAll(
      patchSet({ [MODULE]: ok, "/content/about.val.ts": ok }),
    );
    expect(plan.modules).toHaveLength(2);
    expect(plan.modules[0].patch[0].path).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  test("a module this Val cannot read is left out, and the rest still revert", () => {
    const plan = planRevertAll(
      patchSet({
        [MODULE]: ok,
        "/content/about.val.ts": { ...ok, schema: null },
      }),
    );
    expect(plan.modules.map((m) => m.moduleFilePath)).toEqual([MODULE]);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].reason).toContain("different version of Val");
  });

  test("a module with no recorded content is left ALONE, not emptied", () => {
    // Writing an empty module here would delete whatever is there now — a
    // revert that destroys more than it restores.
    const plan = planRevertAll(patchSet({ [MODULE]: { ...ok, source: null } }));
    expect(plan.modules).toEqual([]);
    expect(plan.blocked).toHaveLength(1);
  });
});
