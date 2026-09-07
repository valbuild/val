import type { PatchId } from "@valbuild/core";
import type { ChangeTreeNode } from "./computeChangedSourcePaths";
import { splitTreesByStaging } from "./splitTreesByStaging";

/**
 * Splitting the review view into a staged and an unstaged section.
 *
 * The property that matters is that a MODULE is not the unit: one module file
 * routinely carries several patch sets, and the unit of staging is the patch set.
 * A module with a staged title and a held list has to show up on both sides,
 * carrying only the rows that belong there.
 */

function node(
  sourcePath: string,
  opts: { patchIds?: string[]; children?: ChangeTreeNode[] } = {},
): ChangeTreeNode {
  return {
    sourcePath: sourcePath as ChangeTreeNode["sourcePath"],
    lastUpdated: "2026-01-01T00:00:00Z",
    isCommitted: false,
    change: opts.patchIds
      ? {
          changeType: "field-change",
          patchIds: opts.patchIds as PatchId[],
          authors: [],
          lastUpdatedBy: null,
          patchesByAuthorIds: {},
        }
      : undefined,
    children: opts.children ?? [],
  };
}

/** Every id in `heldIds` is held; everything else is staged. */
function stagingWhere(heldIds: string[]) {
  const held = new Set(heldIds);
  return (patchIds: readonly PatchId[]): "staged" | "held" | "partial" => {
    const inHeld = patchIds.filter((id) => held.has(id)).length;
    if (inHeld === 0) return "staged";
    if (inHeld === patchIds.length) return "held";
    return "partial";
  };
}

function paths(trees: ChangeTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (n: ChangeTreeNode) => {
    if (n.change) out.push(n.sourcePath as string);
    n.children.forEach(walk);
  };
  trees.forEach(walk);
  return out;
}

test("with nothing held, everything is staged and the held side is empty", () => {
  const trees = [
    node("/p.val.ts", {
      children: [
        node("/p.val.ts?title", { patchIds: ["p1"] }),
        node("/p.val.ts?items", { patchIds: ["p2"] }),
      ],
    }),
  ];
  const { staged, held } = splitTreesByStaging(trees, stagingWhere([]));
  expect(paths(staged)).toEqual(["/p.val.ts?title", "/p.val.ts?items"]);
  expect(held).toEqual([]);
});

test("one module with a staged row and a held row appears on BOTH sides", () => {
  const trees = [
    node("/p.val.ts", {
      children: [
        node("/p.val.ts?title", { patchIds: ["p1"] }),
        node("/p.val.ts?items", { patchIds: ["p2"] }),
      ],
    }),
  ];
  const { staged, held } = splitTreesByStaging(trees, stagingWhere(["p2"]));
  // The module is the container, not the unit — so it is present in both, each
  // time carrying only its own side's rows.
  expect(paths(staged)).toEqual(["/p.val.ts?title"]);
  expect(paths(held)).toEqual(["/p.val.ts?items"]);
  expect(staged).toHaveLength(1);
  expect(held).toHaveLength(1);
});

test("a module with nothing held does not appear in the held section at all", () => {
  const trees = [
    node("/a.val.ts", {
      children: [node("/a.val.ts?x", { patchIds: ["p1"] })],
    }),
    node("/b.val.ts", {
      children: [node("/b.val.ts?y", { patchIds: ["p2"] })],
    }),
  ];
  const { staged, held } = splitTreesByStaging(trees, stagingWhere(["p2"]));
  expect(staged).toHaveLength(1);
  expect(held).toHaveLength(1);
  expect(paths(staged)).toEqual(["/a.val.ts?x"]);
  expect(paths(held)).toEqual(["/b.val.ts?y"]);
});

test("a parent's own change goes to its side without dragging its children along", () => {
  // The module-level row is staged; a field row under it is held. The held side
  // must keep the module as STRUCTURE only — rendering its change there would
  // show a staged change in the unstaged section.
  const trees = [
    node("/p.val.ts", {
      patchIds: ["p1"],
      children: [node("/p.val.ts?items", { patchIds: ["p2"] })],
    }),
  ];
  const { staged, held } = splitTreesByStaging(trees, stagingWhere(["p2"]));
  expect(paths(staged)).toEqual(["/p.val.ts"]);
  expect(paths(held)).toEqual(["/p.val.ts?items"]);
  expect(held[0].change).toBeUndefined();
});

test("a partial row publishes, so it sits on the staged side", () => {
  // Partial is only reachable for a row spanning several patch sets. Some of
  // what it describes will ship, so the section that ships is the honest home
  // for it — the row's own pill still says "partial".
  const trees = [
    node("/p.val.ts", {
      children: [node("/p.val.ts?both", { patchIds: ["p1", "p2"] })],
    }),
  ];
  const { staged, held } = splitTreesByStaging(trees, stagingWhere(["p2"]));
  expect(paths(staged)).toEqual(["/p.val.ts?both"]);
  expect(held).toEqual([]);
});

test("the split never invents or loses a row", () => {
  const trees = [
    node("/p.val.ts", {
      children: [
        node("/p.val.ts?a", { patchIds: ["p1"] }),
        node("/p.val.ts?b", { patchIds: ["p2"] }),
        node("/p.val.ts?c", { patchIds: ["p3"] }),
      ],
    }),
  ];
  const { staged, held } = splitTreesByStaging(trees, stagingWhere(["p2"]));
  expect([...paths(staged), ...paths(held)].sort()).toEqual([
    "/p.val.ts?a",
    "/p.val.ts?b",
    "/p.val.ts?c",
  ]);
});

test("the input trees are not mutated", () => {
  const trees = [
    node("/p.val.ts", {
      children: [
        node("/p.val.ts?a", { patchIds: ["p1"] }),
        node("/p.val.ts?b", { patchIds: ["p2"] }),
      ],
    }),
  ];
  const before = JSON.stringify(trees);
  splitTreesByStaging(trees, stagingWhere(["p2"]));
  expect(JSON.stringify(trees)).toBe(before);
});
