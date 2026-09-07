import type { PatchId } from "@valbuild/core";
import type { ChangeTreeNode } from "./computeChangedSourcePaths";

/**
 * What the compare view needs to know about a node's staging, without importing
 * the provider. Mirrors `PatchStaging.stateOf`.
 */
export type StagingStateOf = (
  patchIds: readonly PatchId[],
) => "staged" | "held" | "partial";

export type SplitTrees = {
  /** Trees whose changes will publish. */
  staged: ChangeTreeNode[];
  /** Trees whose changes are held back and will not. */
  held: ChangeTreeNode[];
};

/**
 * Split each tree into the part that is staged and the part that is held.
 *
 * A module is NOT staged or held as a whole — the unit of staging is the patch
 * set, and one module file routinely carries several. So a module with a staged
 * title and a held list has to appear in both sections, showing only the rows
 * that belong there.
 *
 * This is the same move `isCommitted` already makes one level up: "a patch set
 * carrying both committed and pending patches is SPLIT into two, and the halves
 * end up in different trees" (see `ChangeTreeNode.isCommitted`). Splitting the
 * tree rather than tagging each row is what lets the view render two plain lists
 * and keeps every row component unaware that sections exist.
 *
 * A node with no `change` of its own is structure — a module or an object on the
 * way down to a field. It survives into a side only if something under it did,
 * which is what stops an empty module header appearing in a section that holds
 * none of its rows.
 *
 * `partial` counts as staged. A row can only be partial when it spans more than
 * one patch set (a module-level row), so some of what it describes WILL publish,
 * and the honest place for it is the section that publishes. The row's own pill
 * still reads "partial", so nothing here claims it is wholly one or the other.
 */
export function splitTreesByStaging(
  trees: ChangeTreeNode[],
  stateOf: StagingStateOf,
): SplitTrees {
  const staged: ChangeTreeNode[] = [];
  const held: ChangeTreeNode[] = [];
  for (const tree of trees) {
    const stagedSide = filterTree(tree, stateOf, "staged");
    const heldSide = filterTree(tree, stateOf, "held");
    if (stagedSide) {
      staged.push(stagedSide);
    }
    if (heldSide) {
      held.push(heldSide);
    }
  }
  return { staged, held };
}

function filterTree(
  node: ChangeTreeNode,
  stateOf: StagingStateOf,
  want: "staged" | "held",
): ChangeTreeNode | null {
  const children: ChangeTreeNode[] = [];
  for (const child of node.children) {
    const kept = filterTree(child, stateOf, want);
    if (kept) {
      children.push(kept);
    }
  }
  const keepsOwnChange =
    node.change !== undefined && belongsTo(node.change.patchIds, stateOf, want);
  if (!keepsOwnChange && children.length === 0) {
    return null;
  }
  if (keepsOwnChange) {
    return { ...node, children };
  }
  // Structure only: kept because a descendant belongs here, so its own change —
  // which belongs to the other side — must not be rendered in this one.
  return { ...node, change: undefined, children };
}

function belongsTo(
  patchIds: readonly PatchId[],
  stateOf: StagingStateOf,
  want: "staged" | "held",
): boolean {
  // A row with no patches behind it cannot be staged or unstaged, and belongs
  // wherever it would have been without staging: the staged side.
  if (patchIds.length === 0) {
    return want === "staged";
  }
  const state = stateOf(patchIds);
  return want === "staged" ? state !== "held" : state === "held";
}
