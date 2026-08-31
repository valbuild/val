import {
  initVal,
  type ModuleFilePath,
  type SerializedSchema,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
  type ReadonlyJSONValue,
} from "@valbuild/core/patch";
import {
  computeRestorePatches,
  previewPatchId,
  type ModuleRestoreInput,
} from "./computeRestorePatches";
import { PatchSets } from "../utils/PatchSets";

const { s } = initVal();
const path = "/content/page.val.ts" as ModuleFilePath;

const schema = (): SerializedSchema =>
  s
    .object({
      title: s.string(),
      count: s.number(),
      items: s.array(s.object({ n: s.number() })),
    })
    ["executeSerialize"]();

function preview(modules: ModuleRestoreInput[]) {
  return computeRestorePatches(modules, previewPatchId);
}

describe("computeRestorePatches", () => {
  test("produces ops that turn current back into the commit's version", () => {
    const current: JSONValue = { title: "now", count: 2 };
    const atCommit: JSONValue = { title: "then", count: 1 };
    const { units } = preview([{ moduleFilePath: path, current, atCommit }]);

    const applied = applyPatch(
      deepClone(current as ReadonlyJSONValue) as JSONValue,
      new JSONOps(),
      units.flatMap((u) => u.patch),
    );
    if (result.isErr(applied)) throw new Error(applied.error.message);
    expect(applied.value).toEqual(atCommit);
  });

  // The direction matters: restoring UNDOES what happened since, it does not
  // replay the commit's original patches.
  test("restores to the commit's result, not by replaying its patches", () => {
    const { units } = preview([
      {
        moduleFilePath: path,
        current: { title: "third edit" },
        atCommit: { title: "first edit" },
      },
    ]);
    expect(units.map((u) => u.op)).toEqual([
      { op: "replace", path: ["title"], value: "first edit" },
    ]);
  });

  test("one unit per op, each with its own id", () => {
    const { units } = preview([
      {
        moduleFilePath: path,
        current: { title: "a", count: 1 },
        atCommit: { title: "b", count: 2 },
      },
    ]);
    expect(units).toHaveLength(2);
    expect(new Set(units.map((u) => u.patchId)).size).toBe(2);
    for (const unit of units) {
      expect(unit.patch).toHaveLength(1);
    }
  });

  test("reports a module with no differences instead of emitting nothing", () => {
    const same: JSONValue = { title: "a" };
    const { units, unchanged } = preview([
      { moduleFilePath: path, current: same, atCommit: same },
    ]);
    expect(units).toEqual([]);
    expect(unchanged).toEqual([path]);
  });

  test("a module that exists at the commit but not now restores wholesale", () => {
    const { units } = preview([
      { moduleFilePath: path, current: null, atCommit: { title: "back" } },
    ]);
    expect(units).toHaveLength(1);
    expect(units[0].op).toEqual({
      op: "replace",
      path: [],
      value: { title: "back" },
    });
  });

  test("a module that could not be reconstructed yields nothing to restore", () => {
    const { units, unchanged } = preview([
      { moduleFilePath: path, current: { title: "a" }, atCommit: null },
    ]);
    expect(units).toEqual([]);
    expect(unchanged).toEqual([]);
  });

  test("ids are stable across recomputes of the same preview", () => {
    const input: ModuleRestoreInput[] = [
      {
        moduleFilePath: path,
        current: { title: "a", count: 1 },
        atCommit: { title: "b", count: 2 },
      },
    ];
    expect(preview(input).units.map((u) => u.patchId)).toEqual(
      preview(input).units.map((u) => u.patchId),
    );
  });

  /**
   * The load-bearing integration: these synthetic units must group into
   * INDEPENDENT sets, one per path, through the real PatchSets.
   *
   * This is also the regression test for the constraint that shaped the whole
   * design - PatchSets.insert returns early for the 2nd+ op of a patch id, so
   * a single patch carrying N ops would silently lose N-1 of them.
   */
  describe("grouping through PatchSets", () => {
    test("each unit becomes its own patch set, keyed by path", () => {
      const { units } = preview([
        {
          moduleFilePath: path,
          current: { title: "a", count: 1 },
          atCommit: { title: "b", count: 2 },
        },
      ]);

      const patchSets = new PatchSets();
      for (const unit of units) {
        patchSets.insert(
          unit.moduleFilePath,
          schema(),
          unit.op,
          unit.patchId,
          new Date().toISOString(),
          null,
        );
      }
      const serialized = patchSets.serialize();
      expect(serialized).toHaveLength(2);
      expect(serialized.map((set) => set.patchPath.join("/")).sort()).toEqual([
        "count",
        "title",
      ]);
    });

    // Proves the "one id per op" rule is actually required: reusing one id
    // collapses the units and loses all but the first.
    test("reusing one patch id would lose every op after the first", () => {
      const { units } = preview([
        {
          moduleFilePath: path,
          current: { title: "a", count: 1 },
          atCommit: { title: "b", count: 2 },
        },
      ]);

      const patchSets = new PatchSets();
      const oneId = units[0].patchId;
      for (const unit of units) {
        patchSets.insert(
          unit.moduleFilePath,
          schema(),
          unit.op,
          oneId,
          new Date().toISOString(),
          null,
        );
      }
      expect(patchSets.serialize()).toHaveLength(1);
    });

    test("per-item array edits group as separate sets", () => {
      const { units } = preview([
        {
          moduleFilePath: path,
          current: { items: [{ n: 1 }, { n: 2 }] },
          atCommit: { items: [{ n: 9 }, { n: 8 }] },
        },
      ]);
      expect(units).toHaveLength(2);

      const patchSets = new PatchSets();
      for (const unit of units) {
        patchSets.insert(
          unit.moduleFilePath,
          schema(),
          unit.op,
          unit.patchId,
          new Date().toISOString(),
          null,
        );
      }
      expect(patchSets.serialize()).toHaveLength(2);
    });
  });
});
