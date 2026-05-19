import {
  Internal,
  ModuleFilePath,
  ModulePath,
  PatchId,
  SourcePath,
} from "@valbuild/core";
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

export function computeChangedSourcePaths(
  patchSets: SerializedPatchSet,
): ComputeChangedSourcePathsResult {
  const treesByModule: Record<string, ChangeTreeNode> = {};

  for (const patchSet of patchSets) {
    const changeType = determineChangeType(patchSet);
    if (changeType === null) continue;

    const { moduleFilePath } = patchSet;

    if (!treesByModule[moduleFilePath]) {
      treesByModule[moduleFilePath] = {
        sourcePath: moduleFilePath,
        lastUpdated: patchSet.lastUpdated,
        children: [],
      };
    }

    const root = treesByModule[moduleFilePath];
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
    );
  }

  const trees = Object.values(treesByModule);

  for (const tree of trees) {
    bubbleUpLastUpdated(tree);
    sortTreeAlphabetically(tree);
  }

  // Sort root trees by lastUpdated descending
  trees.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));

  return { trees };
}
