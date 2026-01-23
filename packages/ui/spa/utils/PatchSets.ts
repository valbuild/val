import { ModuleFilePath, PatchId, SerializedSchema } from "@valbuild/core";
import { Operation } from "@valbuild/core/patch";
import { schemaTypesOfPath } from "./schemaTypesOfPath";

type AuthorId = string;
type IsoDateString = string;
export type PatchMetadata = {
  patchId: PatchId;
  patchPath: PatchPath;
  opType: Operation["op"];
  schemaTypes: Array<SerializedSchema["type"]>;
  author: AuthorId | null;
  createdAt: IsoDateString;
};
export type PatchSetMetadata = {
  moduleFilePath: ModuleFilePath;
  patchPath: PatchPath;
  patches: PatchMetadata[];
  authors: AuthorId[];
  opTypes: Operation["op"][];
  schemaTypes: Array<SerializedSchema["type"]>;
  lastUpdated: IsoDateString;
  lastUpdatedBy: AuthorId | null;
};
// Examples: /file/name.val.ts?/path/to/patch
type InternalPatchSetPath = string;
/**
 * A patch set is a set of patches that are non-independent of each other. This is useful for example when we want to apply a set of patches atomically.
 * A patch set is identified by a module file path and a json patch path delimited by a '?' character. We call this the patch set path. Example: /file/name.val.ts?/path/to/patch
 *
 *
 * NOTE: the order of patch sets is always newest first. This is because the UX always shows the newest patches first.
 */
export type SerializedPatchSet = PatchSetMetadata[];
type PatchPath = string[];

export class PatchSets {
  private insertedPatches: Set<PatchId>;
  private patchSetMetadata: Record<InternalPatchSetPath, PatchSetMetadata>;
  private orderedInsertKeys: (InternalPatchSetPath | ModuleFilePath)[];

  constructor() {
    this.patchSetMetadata = {};
    this.orderedInsertKeys = [];
    this.insertedPatches = new Set();
  }

  reset() {
    this.patchSetMetadata = {};
    this.orderedInsertKeys = [];
    this.insertedPatches = new Set();
  }

  getInsertedPatches(): Set<PatchId> {
    return this.insertedPatches;
  }

  private insertPath(
    moduleFilePath: ModuleFilePath,
    affectsPatchPath: PatchPath,
    patchId: PatchId,
    createdAt: IsoDateString,
    author: AuthorId | null,
    opType: Operation["op"],
    schemaTypes: SerializedSchema["type"][],
    opPath: PatchPath
  ) {
    let newPatchSetPath =
      affectsPatchPath.length > 0
        ? `${moduleFilePath}?${affectsPatchPath.join("/")}`
        : moduleFilePath;
    const pathIndexesThatMustBeMerged: number[] = [];
    // TODO: current implementation is O(n), with startsWith it is: O(n x m) - there's room for optimization (Trie?). Just make sure order is maintained and that insert AND then serialize is what we optimize for because the UX will do an insert, then serialize immediately after
    for (let i = this.orderedInsertKeys.length - 1; i >= 0; i--) {
      const currentInsertKey = this.orderedInsertKeys[i];
      // We think .startsWith would not be correct unless we had 1) .val.ts to end the files 2) a delimiter ('?') for the patch path (that is there even if it is an empty array) - right?
      // but both 1) and 2) are guaranteed by the format of the patch set path, we can do this (which is simple, but not very efficient?):
      if (newPatchSetPath !== currentInsertKey) {
        if (newPatchSetPath.startsWith(currentInsertKey)) {
          // This new patch set is inside an existing patch set...
          // Use the existing patch set as the new name
          newPatchSetPath = currentInsertKey;
          // Move to new patch set to head
          this.orderedInsertKeys.splice(i, 1);
          this.orderedInsertKeys.unshift(newPatchSetPath);
        } else if (currentInsertKey.startsWith(newPatchSetPath)) {
          // We found a patch set (with a shorter path) that needs to be merged into this new patch set
          pathIndexesThatMustBeMerged.push(i);
        }
      } else {
        // This patch set already exists
        // Move to new patch set to head
        this.orderedInsertKeys.splice(i, 1);
        this.orderedInsertKeys.unshift(newPatchSetPath);
      }
    }

    // Merge existing patch sets into this new one:
    for (const pathIndexThatMustBeMerged of pathIndexesThatMustBeMerged) {
      const moduleFileOrPatchSetPath =
        this.orderedInsertKeys[pathIndexThatMustBeMerged];

      // 1) remove the old patch set path from ordered insert key
      this.orderedInsertKeys.splice(pathIndexThatMustBeMerged, 1);

      // 2) merge metadata into new
      const existingPatchSetMetadata =
        this.patchSetMetadata[moduleFileOrPatchSetPath];

      if (!this.patchSetMetadata[newPatchSetPath]) {
        this.patchSetMetadata[newPatchSetPath] = {
          moduleFilePath,
          patchPath: affectsPatchPath,
          patches: [],
          authors: [],
          opTypes: [],
          schemaTypes: Array.from(schemaTypes),
          lastUpdated: createdAt,
          lastUpdatedBy: author,
        };
      }
      if (existingPatchSetMetadata) {
        for (const patchMetadata of existingPatchSetMetadata.patches.slice()) {
          this.patchSetMetadata[newPatchSetPath].patches.unshift(patchMetadata);
          if (patchMetadata.author !== null) {
            this.patchSetMetadata[newPatchSetPath].authors.unshift(
              patchMetadata.author
            );
          }
          this.patchSetMetadata[newPatchSetPath].opTypes.unshift(
            patchMetadata.opType
          );
        }
      } else {
        throw new Error(
          `Could not find patch set metadata or patch metadata for (inserted) patch set path: ${moduleFileOrPatchSetPath}`
        );
      }

      // 3) delete old metadata
      if (moduleFileOrPatchSetPath !== newPatchSetPath) {
        delete this.patchSetMetadata[moduleFileOrPatchSetPath];
      }
    }

    // Insert new metadata
    if (!this.patchSetMetadata[newPatchSetPath]) {
      this.patchSetMetadata[newPatchSetPath] = {
        moduleFilePath,
        patchPath: affectsPatchPath,
        patches: [],
        authors: [],
        opTypes: [],
        schemaTypes,
        lastUpdated: createdAt,
        lastUpdatedBy: author,
      };
    }
    if (
      author !== null &&
      !this.patchSetMetadata[newPatchSetPath].authors.includes(author)
    ) {
      this.patchSetMetadata[newPatchSetPath].authors.unshift(author);
    }
    this.patchSetMetadata[newPatchSetPath].lastUpdatedBy = author;
    this.patchSetMetadata[newPatchSetPath].lastUpdated = createdAt;
    if (!this.patchSetMetadata[newPatchSetPath].opTypes.includes(opType)) {
      this.patchSetMetadata[newPatchSetPath].opTypes.unshift(opType);
    }
    this.patchSetMetadata[newPatchSetPath].patches.unshift({
      patchPath: opPath,
      patchId,
      author,
      createdAt,
      opType,
      schemaTypes,
    });

    if (!this.orderedInsertKeys.includes(newPatchSetPath)) {
      this.orderedInsertKeys.unshift(newPatchSetPath);
    }
  }

  insert(
    moduleFilePath: ModuleFilePath,
    schema: SerializedSchema | undefined,
    op: Operation,
    patchId: PatchId,
    createdAt: IsoDateString,
    author: AuthorId | null
  ) {
    if (this.insertedPatches.has(patchId)) {
      return;
    }
    if (!schema) {
      this.insertPath(
        moduleFilePath,
        [],
        patchId,
        createdAt,
        author,
        op.op,
        [],
        op.path
      );
      return;
    }

    this.insertedPatches.add(patchId);
    if (op.op === "file" || op.op === "test") {
      return;
    }
    try {
      if (op.op === "replace") {
        const schemaTypesAtPath = schemaTypesOfPath(schema, op.path);
        this.insertPath(
          moduleFilePath,
          op.path,
          patchId,
          createdAt,
          author,
          op.op,
          Array.from(schemaTypesAtPath),
          op.path
        );
      } else if (
        op.op === "add" ||
        op.op === "remove" ||
        op.op === "move" ||
        op.op === "copy"
      ) {
        // This is the default case, were we, to be sure, take the parent of the path and as the patch set
        const path = op.path.slice(0, -1);
        const schemaTypesAtPath = schemaTypesOfPath(schema, path);
        if (schemaTypesAtPath.size === 1 && schemaTypesAtPath.has("array")) {
          // for arrays we would need a lot of logic to create a patch set that is not on the entire parent so for now we do just that
          this.insertPath(
            moduleFilePath,
            path,
            patchId,
            createdAt,
            author,
            op.op,
            Array.from(schemaTypesAtPath),
            op.path
          );
          if (op.op === "move") {
            const path = op.from.slice(0, -1);
            const schemaTypesAtPath = schemaTypesOfPath(schema, path);
            this.insertPath(
              moduleFilePath,
              path,
              patchId,
              createdAt,
              author,
              op.op,
              Array.from(schemaTypesAtPath),
              op.path
            );
          }
        } else if (
          schemaTypesAtPath.size === 1 &&
          schemaTypesAtPath.has("record")
        ) {
          // If we know this is a record, we can be more specific and only insert the path that is being modified
          const path = op.path;
          const schemaTypesAtPath = schemaTypesOfPath(schema, path);
          this.insertPath(
            moduleFilePath,
            path,
            patchId,
            createdAt,
            author,
            op.op,
            Array.from(schemaTypesAtPath),
            op.path
          );
          if (op.op === "move") {
            const path = op.from;
            const schemaTypesAtPath = schemaTypesOfPath(schema, path);
            this.insertPath(
              moduleFilePath,
              path,
              patchId,
              createdAt,
              author,
              op.op,
              Array.from(schemaTypesAtPath),
              op.path
            );
          }
        } else if (
          schemaTypesAtPath.size === 1 &&
          !(schemaTypesAtPath.has("image") || schemaTypesAtPath.has("file"))
        ) {
          throw new Error(
            `Cannot perform op: '${
              op.op
            }' on non-array or non-record schema. Type: ${
              schemaTypesAtPath.values().next().value
            }`
          );
        } else {
          // we cannot really know if this is a record or array so the entire module is the patch set
          this.insertPath(
            moduleFilePath,
            path,
            patchId,
            createdAt,
            author,
            op.op,
            [schema.type],
            op.path
          );
        }
      } else {
        const _unreachable: never = op;
        throw new Error("Unreachable op: " + _unreachable);
      }
    } catch (e) {
      // We might be in this situation if the schema changes, etc etc:
      if (e instanceof Error) {
        console.error(
          "Could not resolve path while creating patch set",
          e.message
        );
      } else {
        console.error("Could not resolve path while creating patch set", e);
      }
      // "terminate" the entire module file path (i.e. all patches are their own patch set)
      this.insertPath(
        moduleFilePath,
        [],
        patchId,
        createdAt,
        author,
        op.op,
        [schema.type],
        op.path
      );
    }
  }

  isInserted(patchId: PatchId): boolean {
    return this.insertedPatches.has(patchId);
  }

  serialize(): SerializedPatchSet {
    return this.orderedInsertKeys.map((key) => {
      if (key in this.patchSetMetadata) {
        return this.patchSetMetadata[key];
      } else {
        throw new Error(
          `Could not find patch set metadata or patch metadata for (inserted) patch set path: ${key}`
        );
      }
    });
  }
}
