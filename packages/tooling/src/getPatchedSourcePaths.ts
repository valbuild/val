import { ModuleFilePath, Schema, SelectorSource } from "@valbuild/core";
import { Patch } from "@valbuild/core/src/patch";

export function getPatchedSourcePaths(
  moduleFilePath: ModuleFilePath,
  schema: Schema<SelectorSource>,
  patches: Patch[],
): SourcePath[] {
  return getPatchedPatchPaths(patches);
}

/**
 * Get the patch "upper-most" paths that have been touched by the patches.
 * Example: if an op replaces /array/1/object/field1, then another replaces /array/1, then the changed path is /array/1.
 *
 * Different from  `getChangedSourcePaths` in that it returns the paths that have been patched, not the complete source paths (which requires schema to be complete).
 */
function getPatchedPatchPaths(patches: Patch[]): string[][] {
  const trie = new PathTrie();
  for (const patch of patches) {
    for (const op of patch) {
      if (op.op === "file") {
        // skip file ops
        continue;
      } else if (op.op === "test") {
        // skip
        continue;
      } else if (op.op === "move") {
        if (!trie.includes(op.path)) {
          trie.insert(op.path);
        }
        if (!trie.includes(op.from)) {
          trie.insert(op.from);
        }
      } else if (op.op === "replace") {
        if (!trie.includes(op.path)) {
          trie.insert(op.path);
        }
      } else if (op.op === "add" || op.op === "remove") {
        if (!trie.includes(op.path.slice(-1))) {
          trie.insert(op.path.slice(-1));
        }
      } else if (op.op === "copy") {
        if (!trie.includes(op.path)) {
          trie.insert(op.path);
        }
      } else {
        const _exhaustiveCheck: never = op;
        throw new Error(`Unrecognized op: ${_exhaustiveCheck}`);
      }
    }
  }
  return trie.getPaths();
}

class TrieNode {
  children: Map<string, TrieNode>;
  isEndOfPath: boolean;

  constructor() {
    this.children = new Map();
    this.isEndOfPath = false;
  }
}

class PathTrie {
  private root: TrieNode;

  constructor() {
    this.root = new TrieNode();
  }

  insert(path: string[]): void {
    if (!this.includes(path)) {
      let node = this.root;
      for (const part of path) {
        let childNode = node.children.get(part);
        if (!childNode) {
          childNode = new TrieNode();
          node.children.set(part, childNode);
        }
        node = childNode;
      }
      node.isEndOfPath = true;
    }
  }

  includes(prefix: string[]): boolean {
    let node = this.root;
    for (const part of prefix) {
      if (!node.children.has(part)) {
        return false;
      }
      node = node.children.get(part)!;
    }
    return true;
  }

  has(path: string[]): boolean {
    let node = this.root;
    for (const part of path) {
      if (!node.children.has(part)) {
        return false;
      }
      node = node.children.get(part)!;
    }
    return node.isEndOfPath;
  }

  getPaths(): string[][] {
    return this.paths;
  }
}
