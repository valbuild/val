import { initVal, ModuleFilePath, PatchId } from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { PatchSets } from "./PatchSets";
import { joinSharedChanges, selectionClosure } from "./selectionClosure";

const { s } = initVal();
const PAGE = "/content/page.val.ts" as ModuleFilePath;
const OTHER = "/content/other.val.ts" as ModuleFilePath;
const schema = s
  .object({ title: s.string(), list: s.array(s.string()) })
  ["executeSerialize"]();

/** The site's pending changes, in chain order, grouped as the Studio groups them. */
function chain(
  changes: {
    id: string;
    patch: Patch;
    author: string;
    module?: ModuleFilePath;
  }[],
) {
  const sets = new PatchSets();
  for (const change of changes) {
    sets.insert(
      change.module ?? PAGE,
      schema,
      change.patch,
      change.id as PatchId,
      "2026-10-17T00:00:00Z",
      change.author,
    );
  }
  return {
    patchSets: sets.serialize(),
    patchIds: changes.map((change) => change.id as PatchId),
  };
}

describe("selectionClosure", () => {
  test("an earlier change by someone else to the same list comes with the selection; another field does not", () => {
    const { patchSets, patchIds } = chain([
      {
        id: "kari-adds",
        author: "kari",
        patch: [{ op: "add", path: ["list", "0"], value: "first" }],
      },
      {
        id: "ada-title",
        author: "ada",
        patch: [{ op: "replace", path: ["title"], value: "Hello" }],
      },
      {
        id: "ada-item",
        author: "ada",
        patch: [{ op: "replace", path: ["list", "0"], value: "First" }],
      },
    ]);
    expect(
      selectionClosure(patchSets, ["ada-item" as PatchId], patchIds),
    ).toEqual(["kari-adds", "ada-item"]);
    expect(
      selectionClosure(patchSets, ["ada-title" as PatchId], patchIds),
    ).toEqual(["ada-title"]);
  });

  test("sets that share a change come together", () => {
    const { patchSets, patchIds } = chain([
      {
        id: "title",
        author: "kari",
        patch: [{ op: "replace", path: ["title"], value: "Hello" }],
      },
      {
        id: "both",
        author: "kari",
        patch: [
          { op: "replace", path: ["title"], value: "Hi" },
          { op: "add", path: ["list", "0"], value: "first" },
        ],
      },
      {
        id: "item",
        author: "ada",
        patch: [{ op: "replace", path: ["list", "0"], value: "First" }],
      },
      {
        id: "elsewhere",
        author: "ada",
        module: OTHER,
        patch: [{ op: "replace", path: ["title"], value: "Other" }],
      },
    ]);
    expect(selectionClosure(patchSets, ["title" as PatchId], patchIds)).toEqual(
      ["title", "both", "item"],
    );
  });

  test("in chain order, and a change no set knows of is its own", () => {
    const { patchSets, patchIds } = chain([
      {
        id: "a",
        author: "ada",
        patch: [{ op: "replace", path: ["title"], value: "A" }],
      },
    ]);
    const all = ["unknown", ...patchIds] as PatchId[];
    expect(
      selectionClosure(patchSets, ["a", "unknown"] as PatchId[], all),
    ).toEqual(["unknown", "a"]);
  });
});

describe("joinSharedChanges", () => {
  test("joins every set that shares a change, transitively", () => {
    const groups = joinSharedChanges([
      ["a", "b"],
      ["c"],
      ["b", "d"],
      ["d", "c"],
      ["e"],
    ] as PatchId[][]);
    expect(groups.map((group) => [...group].sort())).toEqual([
      ["a", "b", "c", "d"],
      ["e"],
    ]);
  });
});
