import {
  ModuleFilePath,
  PatchId,
  Json,
  Internal,
  SerializedSchema,
} from "@valbuild/core";
import { Operation } from "@valbuild/core/patch";

type PatchSetPath = string; // this uses the JSON Patch format a string that looks like this: /path/to/patch
type PatchPath = string[];
/**
 * A patch set is a set of patches that are non-independent of each other. This is useful for example when we want to apply a set of patches atomically.
 * A patch set is identified by a module file path and a json patch path. The json patch path is a string that looks like this: /path/to/patch
 * If the modules only contains patch ids, then each patch is its own patch set.
 */
export type SerializedPatchSet = Record<
  ModuleFilePath,
  | Record<PatchSetPath, PatchId[]> // we have patch sets
  | PatchId[] // no patch sets (each patch is its own patch set)
>;

/**
 * This class is used to optimize (and simplify) the process of selecting independent sets of patches.
 *
 * The plan is to use the serialized form in the UI, but use the class as a way to make it easier and faster to insert new operations
 */
export class PatchSets {
  private patchSetsByModuleFiles: Record<ModuleFilePath, PatchSetNode>;
  constructor() {
    this.patchSetsByModuleFiles = {};
  }

  reset() {
    this.patchSetsByModuleFiles = {};
  }

  insert(
    moduleFilePath: ModuleFilePath,
    source: Json,
    schema: SerializedSchema,
    op: Operation,
    patchId: PatchId,
  ) {
    if (!this.patchSetsByModuleFiles[moduleFilePath]) {
      this.patchSetsByModuleFiles[moduleFilePath] = new PatchSetNode();
    }
    const node = this.patchSetsByModuleFiles[moduleFilePath];
    if (op.op === "file" || op.op === "test") {
      return;
    }
    if (op.op === "replace") {
      node.insert(op.path, patchId);
    } else if (
      op.op === "add" ||
      op.op === "remove" ||
      op.op === "move" ||
      op.op === "copy"
    ) {
      try {
        const { schema: schemaAtPath } = Internal.resolvePath(
          Internal.patchPathToModulePath(op.path.slice(0, -1)), // get the schema of the parent
          source,
          schema,
        );
        if (schemaAtPath.type === "array") {
          // for arrays we would need a lot of logic to create a patch set that is not on the entire parent so for now we do just that
          node.insert(op.path.slice(0, -1), patchId);
          if (op.op === "move") {
            node.insert(op.from.slice(0, -1), patchId);
          }
        } else if (schemaAtPath.type === "record") {
          node.insert(op.path, patchId);
          if (op.op === "move") {
            node.insert(op.from, patchId);
          }
        } else {
          throw new Error(
            `Cannot perform op: '${op.op}' on non-array or non-record schema. Type: ${
              schemaAtPath.type
            }`,
          );
        }
      } catch (e) {
        // resolvePath might throw an error if the path is not resolvable
        // We think this shouldn't happen since we should have already been able to apply patches prior to doing this so this is just us being defensive
        // We could simply throw the error, but since patch sets is only a client side way to select independent sets of patches we just log the error and continue
        // These are at least the reason for this as it stands now
        if (e instanceof Error) {
          console.error(
            "Could not resolve path while creating patch set",
            e.message,
          );
        } else {
          console.error("Could not resolve path while creating patch set", e);
        }
        // "terminate" the entire module file path (i.e. all patches are their own patch set)
        node.insert([], patchId);
      }
    } else {
      const _unreachable: never = op;
      throw new Error("Unreachable op: " + _unreachable);
    }
  }

  serialize(): SerializedPatchSet {
    const result: SerializedPatchSet = {};
    for (const moduleFilePathS in this.patchSetsByModuleFiles) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const moduleRadixNode = this.patchSetsByModuleFiles[moduleFilePath];
      if (moduleRadixNode.terminal) {
        result[moduleFilePath] = moduleRadixNode.serialize()[""]; // NOTE: on the node level the root is "" and this means we that there are no patch sets within this module. To make it clearer we explicitly set the entire module to be an array of patch ids in this case
      } else {
        result[moduleFilePath] = moduleRadixNode.serialize();
      }
    }
    return result;
  }

  static from(serialized: SerializedPatchSet) {
    const patchSets = new PatchSets();
    for (const moduleFilePathS in serialized) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const moduleRadixNode = PatchSetNode.from(serialized[moduleFilePath]);
      patchSets.patchSetsByModuleFiles[moduleFilePath] = moduleRadixNode;
    }
    return patchSets;
  }
}

class PatchSetNode {
  /** undefined for root node */
  private key?: string; // undefined for root node
  private children: Record<string, PatchSetNode>;
  /**
   * terminal means that there exists a patch path that ends in this node
   * For example if we replace on /foo/bar then /foo/bar is a terminal node.
   * NOTE: if there is first a replace on /foo/bar then on /foo (both are terminal), but the serialized form will merge all sub paths of /foo into /foo
   **/
  terminal: boolean;
  patchIds: PatchId[];

  constructor(key?: string) {
    this.key = key;
    this.terminal = false;
    this.children = {};
    this.patchIds = [];
  }

  insert(patchPath: PatchPath, patchId: PatchId) {
    if (this.key) {
      throw new Error("Cannot insert into a root (non-keyed) node");
    }
    if (patchPath.length === 0) {
      this.terminal = true;
      this.patchIds.push(patchId);
    } else {
      let child: PatchSetNode = this as PatchSetNode;
      for (const key of patchPath) {
        if (isPrototypePollution(key)) {
          throw new Error(
            "Prototype pollution attempt in patch path: " +
              [""].concat(patchPath).join("/"),
          );
        }
        if (!child.children[key]) {
          child.children[key] = new PatchSetNode(key);
        }
        child = child.children[key];
        if (child.terminal) {
          // At this point we could clean up sub-tree and move patchIds into this node
          // However, we take this into account as we serialize currently so that would just be an optimization (or not, depending on how often we serialize vs. insert)
          break;
        }
      }
      child.patchIds.push(patchId);
      child.terminal = true;
    }
  }

  serialize(): Record<PatchSetPath, PatchId[]> {
    const result: Record<PatchSetPath, PatchId[]> = {};
    function go(
      node: PatchSetNode,
      path: string[],
      terminalPath: string[] | null,
    ) {
      let nodeTerminalPath = terminalPath;
      if (!nodeTerminalPath && node.terminal) {
        nodeTerminalPath = path;
      }
      for (const childKey in node.children) {
        const child = node.children[childKey];
        if (!child.key) {
          throw new Error(
            "Cannot serialize a non-keyed, non-root node: " + path,
          );
        }
        go(child, path.concat(child.key), nodeTerminalPath);
      }
      if (nodeTerminalPath) {
        const jsonTerminalPath = nodeTerminalPath.join("/");
        if (!result[jsonTerminalPath]) {
          // NOTE: we always copy the array to avoid mutating the internal patch set state:
          result[jsonTerminalPath] = [...node.patchIds];
        } else {
          result[jsonTerminalPath].push(...node.patchIds);
        }
      }
    }
    if (this.key) {
      throw new Error("Cannot serialize a non-root node");
    }
    for (const childKey in this.children) {
      const child = this.children[childKey];
      go(child, ["", childKey], this.terminal ? [""] : null);
    }
    if (this.terminal) {
      if (!result[""]) {
        result[""] = [];
      }
      result[""].push(...this.patchIds);
    }
    return result;
  }

  static from(serialized: SerializedPatchSet[ModuleFilePath]) {
    if (Array.isArray(serialized)) {
      const node = new PatchSetNode();
      node.terminal = true;
      node.patchIds = serialized;
      return node;
    }
    const root = new PatchSetNode();
    for (const key in serialized) {
      let child = root;
      // skip first empty string (paths start with /)
      for (const keyPart of key.split("/").slice(1)) {
        if (isPrototypePollution(keyPart)) {
          throw new Error("Prototype pollution attempt in: " + key);
        }
        // skip first empty string (paths start with /)
        if (!child.children[keyPart]) {
          child.children[keyPart] = new PatchSetNode(keyPart);
        }
        child = child.children[keyPart];
      }
      child.terminal = true;
      child.patchIds = serialized[key];
    }
    return root;
  }
}

function isPrototypePollution(key: string): boolean {
  // We want to use record to serialize quickly, but we do not want prototype pollution:
  return key === "__proto__" || key === "constructor" || key === "prototype";
}
