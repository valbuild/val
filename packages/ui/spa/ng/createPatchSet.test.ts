import {
  ArraySchema,
  initVal,
  Internal,
  Json,
  ModuleFilePath,
  RecordSchema,
  Schema,
  SelectorSource,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";

const { s } = initVal();

describe("createPatchSet", () => {
  test("should create a patch set", async () => {
    console.log(
      createPatchSet(
        "/content/projects.val.ts" as ModuleFilePath,
        {
          "Project A": {
            title: "Title",
            description: "Description",
          },
        },
        s.record(s.object({ title: s.string(), description: s.string() })),
        [
          {
            patchId: "123",
            patch: [
              {
                op: "replace",
                path: ["Project A", "title"],
                value: "New Title",
              },
            ],
          },
          {
            patchId: "234",
            patch: [
              {
                op: "replace",
                path: ["Project A", "description"],
                value: "New Description",
              },
            ],
          },
          {
            patchId: "456",
            patch: [
              {
                op: "add",
                path: ["Project_B"],
                value: {
                  title: "Title",
                  description: "Description",
                },
              },
            ],
          },
          {
            patchId: "567",
            patch: [
              {
                op: "replace",
                path: ["Project_B", "description"],
                value: "Another Description",
              },
            ],
          },
        ]
      ).serialize()
    );
  });
});

type PatchMeta = {
  patchId: PatchId;
  patch: Patch;
};
function createPatchSet(
  moduleFilePath: ModuleFilePath,
  source: Json,
  schema: Schema<SelectorSource>,
  patches: PatchMeta[]
) {
  const patchSet = new PatchSets();
  for (const patch of patches) {
    for (const op of patch.patch) {
      if (op.op === "file" || op.op === "test") {
        continue;
      }
      if (op.op === "replace") {
        patchSet.insert(moduleFilePath, op.path, patch.patchId);
      } else if (
        op.op === "add" ||
        op.op === "remove" ||
        op.op === "move" ||
        op.op === "copy"
      ) {
        const { schema: schemaAtPath } = Internal.resolvePath(
          Internal.patchPathToModulePath(op.path.slice(0, -1)),
          source,
          schema
        );
        if (schemaAtPath instanceof ArraySchema) {
          patchSet.insert(moduleFilePath, op.path.slice(0, -1), patch.patchId);
          if (op.op === "move") {
            patchSet.insert(
              moduleFilePath,
              op.from.slice(0, -1),
              patch.patchId
            );
          }
        } else if (schemaAtPath instanceof RecordSchema) {
          patchSet.insert(moduleFilePath, op.path, patch.patchId);
          if (op.op === "move") {
            patchSet.insert(moduleFilePath, op.from, patch.patchId);
          }
        } else {
          throw new Error(
            `Cannot ${op.op} on non-array or non-record schema. Type: ${
              schemaAtPath.serialize().type
            }`
          );
        }
      } else {
        const _unreachable: never = op;
        throw new Error("Unreachable op: " + _unreachable);
      }
    }
  }
  return patchSet;
}

type PatchId = string;
type TerminalJsonPatchPath = string; // terminated (means that this is a patch set identifier) json patch path means that it is a string that looks like this: /path/to/patch
type PatchPath = string[];

class PatchSets {
  private radixTree: Record<ModuleFilePath, PatchSetNode>;
  constructor() {
    this.radixTree = {};
  }

  reset() {
    this.radixTree = {};
  }

  insert(
    moduleFilePath: ModuleFilePath,
    patchPath: PatchPath,
    patchId: PatchId
  ) {
    if (!this.radixTree[moduleFilePath]) {
      this.radixTree[moduleFilePath] = new PatchSetNode();
    }
    this.radixTree[moduleFilePath].insert(patchPath, patchId);
  }

  serialize() {
    const result: Record<
      ModuleFilePath,
      Record<TerminalJsonPatchPath, PatchId[]>
    > = {};
    for (const moduleFilePathS in this.radixTree) {
      const moduleFilePath = moduleFilePathS as ModuleFilePath;
      const moduleRadixNode = this.radixTree[moduleFilePath];
      result[moduleFilePath] = moduleRadixNode.serialize();
    }
    return result;
  }
}

class PatchSetNode {
  private key?: string; // undefined for root node
  private children: Record<string, PatchSetNode>;
  private terminal: boolean;
  private patchIds: PatchId[];

  constructor(key?: string) {
    if (key && !this.isValidKey(key)) {
      throw new Error("Invalid key: " + key);
    }
    this.key = key;
    this.terminal = false;
    this.children = {};
    this.patchIds = [];
  }

  private isValidKey(key: string): boolean {
    // We want to use record to serialize quickly, but we do not want prototype pollution:
    return key !== "__proto__" && key !== "constructor" && key !== "prototype";
  }

  serialize(): Record<TerminalJsonPatchPath, PatchId[]> {
    const result: Record<TerminalJsonPatchPath, PatchId[]> = {};
    function go(
      node: PatchSetNode,
      path: string[],
      terminalPath: string[] | null
    ) {
      let nodeTerminalPath = terminalPath;
      if (!nodeTerminalPath && node.terminal) {
        nodeTerminalPath = path;
      }
      if (nodeTerminalPath) {
        const jsonTerminalPath = nodeTerminalPath.join("/");
        if (!result[jsonTerminalPath]) {
          result[jsonTerminalPath] = node.patchIds;
        } else {
          result[jsonTerminalPath].push(...node.patchIds);
        }
      }
      for (const childKey in node.children) {
        const child = node.children[childKey];
        if (!child.key) {
          throw new Error(
            "Cannot serialize a non-keyed, non-root node: " + path
          );
        }
        go(child, path.concat(child.key), nodeTerminalPath);
      }
    }
    if (this.key) {
      throw new Error("Cannot serialize a non-root node");
    }
    for (const childKey in this.children) {
      const child = this.children[childKey];
      go(child, [""], this.terminal ? [""] : null);
    }
    return result;
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
        if (!child.children[key]) {
          child.children[key] = new PatchSetNode(key);
        }
        child = child.children[key];
        if (child.terminal) {
          // TODO: clean up sub-tree and move patchIds into this node
          break;
        }
      }
      child.patchIds.push(patchId);
      child.terminal = true;
    }
  }
}
