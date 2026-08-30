import {
  Internal,
  ModuleFilePath,
  ModulePath,
  PatchId,
  SourcePath,
} from "@valbuild/core";
import type { Operation } from "@valbuild/core/patch";
import {
  PatchMetadata,
  PatchSetMetadata,
  SerializedPatchSet,
} from "./PatchSets";

export type ChangeType = "added" | "removed" | "moved" | "field-change";

export type ChangeTreePatch = {
  moduleFilePath: ModuleFilePath;
  patchId: PatchId;
  opType: PatchMetadata["opType"];
  createdAt: string;
  authorId: string | null;
};

export type ChangeTreeNode = {
  sourcePath: SourcePath | ModuleFilePath;
  lastUpdated: string;
  /**
   * Whether every change at or under this node has already shipped in a commit.
   *
   * True for one whole tree or false for one whole tree, never mixed: a patch set
   * carrying both committed and pending patches is SPLIT into two, and the halves
   * end up in different trees. That is what lets the review UI draw one line
   * between what is still yours and what is on its way to production, and hide the
   * discard controls below it, without asking a question of every row.
   *
   * Only ever true in `http` mode. In `fs` mode a published patch is deleted
   * rather than kept and re-applied, so nothing in the chain has shipped.
   */
  isCommitted: boolean;
  change?: {
    changeType: ChangeType;
    patchIds: PatchId[];
    authors: string[];
    lastUpdatedBy: string | null;
    patchesByAuthorIds: Record<string, ChangeTreePatch[]>;
  };
  children: ChangeTreeNode[];
};

export type ComputeChangedSourcePathsResult = {
  trees: ChangeTreeNode[];
};

function patchPathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function determineChangeType(patchSet: PatchSetMetadata): ChangeType | null {
  const patchSetPath = patchSet.patchPath;

  let hasAddAtRoot = false;
  let hasRemoveAtRoot = false;
  let hasMoveAtRoot = false;

  for (const patch of patchSet.patches) {
    if (patchPathsEqual(patch.patchPath, patchSetPath)) {
      if (patch.opType === "add") hasAddAtRoot = true;
      if (patch.opType === "remove") hasRemoveAtRoot = true;
      if (patch.opType === "move") hasMoveAtRoot = true;
    }
  }

  // Cancellation: add + remove = nothing to show
  if (hasAddAtRoot && hasRemoveAtRoot) return null;

  // Cancellation: move + remove = removed
  if (hasMoveAtRoot && hasRemoveAtRoot) return "removed";

  // Priority: added > moved > removed > field-change
  if (hasAddAtRoot) return "added";
  if (hasMoveAtRoot) return "moved";
  if (hasRemoveAtRoot) return "removed";

  return "field-change";
}

function makeSourcePath(
  moduleFilePath: ModuleFilePath,
  patchPath: string[],
): SourcePath {
  if (patchPath.length === 0) {
    return moduleFilePath as unknown as SourcePath;
  }
  const modulePath = Internal.patchPathToModulePath(patchPath);
  return Internal.joinModuleFilePathAndModulePath(moduleFilePath, modulePath);
}

function buildPatchesByAuthorIds(
  moduleFilePath: ModuleFilePath,
  patches: PatchMetadata[],
): Record<string, ChangeTreePatch[]> {
  const result: Record<string, ChangeTreePatch[]> = {};
  for (const patch of patches) {
    const authorKey = patch.author ?? "unknown";
    if (!result[authorKey]) {
      result[authorKey] = [];
    }
    result[authorKey].push({
      moduleFilePath,
      patchId: patch.patchId,
      opType: patch.opType,
      createdAt: patch.createdAt,
      authorId: patch.author,
    });
  }
  return result;
}

function insertIntoTree(
  root: ChangeTreeNode,
  moduleFilePath: ModuleFilePath,
  patchPath: string[],
  changeType: ChangeType,
  patchIds: PatchId[],
  authors: string[],
  lastUpdated: string,
  lastUpdatedBy: string | null,
  patchesByAuthorIds: Record<string, ChangeTreePatch[]>,
  isCommitted: boolean,
): void {
  if (patchPath.length === 0) {
    root.change = {
      changeType,
      patchIds,
      authors,
      lastUpdatedBy,
      patchesByAuthorIds,
    };
    if (lastUpdated > root.lastUpdated) {
      root.lastUpdated = lastUpdated;
    }
    return;
  }

  let current = root;
  for (let i = 0; i < patchPath.length; i++) {
    const segmentPath = patchPath.slice(0, i + 1);
    const sourcePath = makeSourcePath(moduleFilePath, segmentPath);
    const isLeaf = i === patchPath.length - 1;

    let child = current.children.find((c) => c.sourcePath === sourcePath);
    if (!child) {
      child = {
        sourcePath,
        lastUpdated,
        isCommitted,
        children: [],
      };
      current.children.push(child);
    }

    if (lastUpdated > child.lastUpdated) {
      child.lastUpdated = lastUpdated;
    }

    if (isLeaf) {
      child.change = {
        changeType,
        patchIds,
        authors,
        lastUpdatedBy,
        patchesByAuthorIds,
      };
    }

    current = child;
  }
}

function bubbleUpLastUpdated(node: ChangeTreeNode): string {
  let max = node.lastUpdated;
  for (const child of node.children) {
    const childMax = bubbleUpLastUpdated(child);
    if (childMax > max) {
      max = childMax;
    }
  }
  node.lastUpdated = max;
  return max;
}

function getLastSegment(sourcePath: SourcePath | ModuleFilePath): string {
  const path = String(sourcePath);
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    path as SourcePath,
  );
  if (!modulePath) {
    return path;
  }
  const segments = Internal.splitModulePath(modulePath as ModulePath);
  return segments[segments.length - 1] ?? path;
}

function sortTreeAlphabetically(node: ChangeTreeNode): void {
  node.children.sort((a, b) =>
    getLastSegment(a.sourcePath).localeCompare(getLastSegment(b.sourcePath)),
  );
  for (const child of node.children) {
    sortTreeAlphabetically(child);
  }
}

/**
 * One half of a patch set: the same change, narrowed to some of its patches.
 *
 * Everything a half derives from its own patches rather than inheriting from the
 * whole — authors, op types, when it was last touched and by whom — because those
 * are exactly the fields a review row shows, and inheriting them would have the
 * pending half credited with the author and the timestamp of a commit that has
 * already gone out.
 *
 * `schemaTypes` is the exception: it describes the SHAPE at the set's path, which
 * is a property of the schema and not of which patches are being looked at.
 *
 * `patches` is never empty: the only caller returns early when either side of the
 * split is, so a half exists only when there is something in it.
 */
function halfOf(
  patchSet: PatchSetMetadata,
  patches: PatchMetadata[],
): PatchSetMetadata {
  const authors: string[] = [];
  const opTypes: Operation["op"][] = [];
  // `PatchSets` unshifts, so index 0 is the newest — but the max is taken rather
  // than assumed, so a caller that builds a set in another order still gets an
  // honest "last updated".
  let lastUpdated = patches[0].createdAt;
  let lastUpdatedBy = patches[0].author;
  for (const patch of patches) {
    if (patch.author !== null && !authors.includes(patch.author)) {
      authors.push(patch.author);
    }
    if (!opTypes.includes(patch.opType)) {
      opTypes.push(patch.opType);
    }
    if (patch.createdAt > lastUpdated) {
      lastUpdated = patch.createdAt;
      lastUpdatedBy = patch.author;
    }
  }
  return {
    moduleFilePath: patchSet.moduleFilePath,
    patchPath: patchSet.patchPath,
    patches,
    authors,
    opTypes,
    schemaTypes: patchSet.schemaTypes,
    lastUpdated,
    lastUpdatedBy,
  };
}

/**
 * A patch set, split into the part that has shipped and the part that has not.
 *
 * A set groups patches by the PATH they touch, which is the right unit for
 * review and says nothing about whether they have been published. So one set can
 * hold a patch that went out in the last commit and a patch made a minute ago —
 * and then it belongs on neither side of the deploy line as a whole. Splitting it
 * is what makes each side true: the committed half describes what is deploying,
 * the pending half describes what is still yours to discard, and discarding it
 * leaves exactly what was published.
 *
 * Returns the set itself as the pending half when nothing in it has shipped,
 * which is every set in `fs` mode and every set before the first publish. That is
 * the common case and it must not pay for this.
 */
function splitByCommitted(
  patchSet: PatchSetMetadata,
  committedPatchIds: ReadonlySet<PatchId>,
): { pending: PatchSetMetadata | null; committed: PatchSetMetadata | null } {
  if (committedPatchIds.size === 0) {
    return { pending: patchSet, committed: null };
  }
  const pendingPatches: PatchMetadata[] = [];
  const committedPatches: PatchMetadata[] = [];
  for (const patch of patchSet.patches) {
    if (committedPatchIds.has(patch.patchId)) {
      committedPatches.push(patch);
    } else {
      pendingPatches.push(patch);
    }
  }
  if (committedPatches.length === 0) {
    return { pending: patchSet, committed: null };
  }
  if (pendingPatches.length === 0) {
    return { pending: null, committed: patchSet };
  }
  return {
    pending: halfOf(patchSet, pendingPatches),
    committed: halfOf(patchSet, committedPatches),
  };
}

/**
 * The key one module's changes group under, for one side of the deploy line.
 *
 * A module with work on both sides is TWO cards, one above the line and one
 * below, so the module file path alone cannot be the key. NUL separates, because
 * it cannot occur in a module file path and so cannot be smuggled in to collide
 * one side with the other.
 */
function treeKey(isCommitted: boolean, moduleFilePath: ModuleFilePath): string {
  return `${isCommitted ? "committed" : "pending"}\u0000${moduleFilePath}`;
}

/**
 * @param committedPatchIds Patches that have already shipped in a commit — see
 *   `useCommittedPatches`. Patch sets are split against it so that no tree mixes
 *   shipped and unshipped work, and the trees come back with the unshipped ones
 *   first. Empty (the default) means nothing has shipped, which is always the
 *   case in `fs` mode.
 */
export function computeChangedSourcePaths(
  patchSets: SerializedPatchSet,
  committedPatchIds: ReadonlySet<PatchId> = new Set(),
): ComputeChangedSourcePathsResult {
  const treesByModule: Record<string, ChangeTreeNode> = {};

  for (const patchSet of patchSets) {
    const { pending, committed } = splitByCommitted(
      patchSet,
      committedPatchIds,
    );
    // Pending first, so that within one side the insertion order still follows
    // the patch sets' own newest-first order.
    for (const half of [
      { set: pending, isCommitted: false },
      { set: committed, isCommitted: true },
    ]) {
      if (half.set === null) continue;
      insertHalf(treesByModule, half.set, half.isCommitted);
    }
  }

  const trees = Object.values(treesByModule);

  for (const tree of trees) {
    bubbleUpLastUpdated(tree);
    sortTreeAlphabetically(tree);
  }

  // Unshipped work first, then newest-first within each side. The review UI draws
  // its divider where the two meet, so the order IS the grouping: a committed
  // tree that sorted above a pending one by timestamp alone would land on the
  // wrong side of the line.
  trees.sort((a, b) => {
    if (a.isCommitted !== b.isCommitted) {
      return a.isCommitted ? 1 : -1;
    }
    return b.lastUpdated.localeCompare(a.lastUpdated);
  });

  return { trees };
}

/** Fold one half of a patch set into the tree for its module and its side. */
function insertHalf(
  treesByModule: Record<string, ChangeTreeNode>,
  patchSet: PatchSetMetadata,
  isCommitted: boolean,
): void {
  const changeType = determineChangeType(patchSet);
  if (changeType === null) return;

  const { moduleFilePath } = patchSet;
  const key = treeKey(isCommitted, moduleFilePath);

  if (!treesByModule[key]) {
    treesByModule[key] = {
      sourcePath: moduleFilePath,
      lastUpdated: patchSet.lastUpdated,
      isCommitted,
      children: [],
    };
  }

  const root = treesByModule[key];
  const patchIds = patchSet.patches.map((p) => p.patchId);
  const authors = patchSet.authors.filter((a): a is string => a !== null);
  const patchesByAuthorIds = buildPatchesByAuthorIds(
    moduleFilePath,
    patchSet.patches,
  );

  insertIntoTree(
    root,
    moduleFilePath,
    patchSet.patchPath,
    changeType,
    patchIds,
    authors,
    patchSet.lastUpdated,
    patchSet.lastUpdatedBy,
    patchesByAuthorIds,
    isCommitted,
  );
}
