import {
  Internal,
  Json,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
} from "@valbuild/core";
import { Operation } from "@valbuild/core/patch";

type AuthorId = string;
type IsoDateString = string;
type PatchMetadata = {
  moduleFilePath: ModuleFilePath;
  patchId: PatchId;
  author: AuthorId | null;
  createdAt: IsoDateString;
  opType: Operation["op"];
  schemaType: SerializedSchema["type"];
};
type PatchSetMetadata = {
  moduleFilePath: ModuleFilePath;
  patchPath: PatchPath;
  patches: PatchMetadata[];
  authors: AuthorId[];
  opTypes: Operation["op"][];
  schemaType: SerializedSchema["type"];
  lastUpdated: IsoDateString;
  lastUpdatedBy: AuthorId | null;
};
// Examples: /file/name.val.ts?/path/to/patch
type InternalPatchSetPath = string;
/**
 * A patch set is a set of patches that are non-independent of each other. This is useful for example when we want to apply a set of patches atomically.
 * A patch set is identified by a module file path and a json patch path delimited by a '?' character. We call this the patch set path. Example: /file/name.val.ts?/path/to/patch
 *
 * NOTE: the order of patch sets is always newest first. This is because the UX always shows the newest patches first.
 */
export type SerializedPatchSet = (
  | PatchSetMetadata
  | [
      ModuleFilePath,
      // no patch sets (each patch is its own patch set):
      PatchMetadata[],
    ]
)[];
type PatchPath = string[];

export class PatchSets {
  private insertedPatches: Set<PatchId>;
  private patchSetMetadata: Record<InternalPatchSetPath, PatchSetMetadata>;
  private patchMetadata: Record<ModuleFilePath, PatchMetadata[]>;
  private orderedInsertKeys: (InternalPatchSetPath | ModuleFilePath)[];

  constructor() {
    this.patchSetMetadata = {};
    this.patchMetadata = {};
    this.orderedInsertKeys = [];
    this.insertedPatches = new Set();
  }

  reset() {
    this.patchSetMetadata = {};
    this.patchMetadata = {};
    this.orderedInsertKeys = [];
    this.insertedPatches = new Set();
  }

  private insertPath(
    moduleFilePath: ModuleFilePath,
    patchPath: PatchPath,
    patchId: PatchId,
    createdAt: IsoDateString,
    author: AuthorId | null,
    opType: Operation["op"],
    schemaType: SerializedSchema["type"],
  ) {
    console.log("start");
    this.insertedPatches.add(patchId);
    const newPatchSetPath = `${moduleFilePath}?${patchPath.join("/")}`;
    const matchingInsertKeyIndexes: number[] = [];
    let hasPatchMetadata = false;
    // TODO: current implementation is O(n), with startsWith it is: O(n x m) - there's room for optimization (Trie?). Just make sure order is maintained and that insert AND then serialize is what we optimize for because that is the usage pattern
    for (let i = this.orderedInsertKeys.length - 1; i >= 0; i--) {
      const currentInsertKey = this.orderedInsertKeys[i];
      // we think .startsWith would not be correct unless we had 1) .val.ts to end the files 2) a delimiter ('?') for the patch path (that is there even if it is an empty array) - right?
      if (currentInsertKey.startsWith(newPatchSetPath)) {
        hasPatchMetadata =
          !!this.patchMetadata[currentInsertKey as ModuleFilePath];
        matchingInsertKeyIndexes.push(i);
      }
    }

    for (const matchingInsertOrderIndex of matchingInsertKeyIndexes) {
      // 1) remove the old patch set path from ordered insert key
      const moduleFileOrPatchSetPath =
        this.orderedInsertKeys[matchingInsertOrderIndex];
      this.orderedInsertKeys.splice(matchingInsertOrderIndex, 1);

      // 2) merge metadata into new
      const existingPatchSetMetadata =
        this.patchSetMetadata[moduleFileOrPatchSetPath];
      const existingPatchMetadata =
        this.patchMetadata[moduleFileOrPatchSetPath as ModuleFilePath];
      if (!existingPatchSetMetadata && !existingPatchMetadata) {
        throw new Error(
          `Could not find patch set metadata or patch metadata for (inserted) patch set path: ${moduleFileOrPatchSetPath}`,
        );
      } else if (!!existingPatchSetMetadata && !!existingPatchMetadata) {
        throw new Error(
          `Found both patch set metadata AND patch metadata for (inserted) patch set path: ${moduleFileOrPatchSetPath}`,
        );
      }
      if (patchPath.length === 0 || hasPatchMetadata) {
        if (!this.patchMetadata[moduleFileOrPatchSetPath as ModuleFilePath]) {
          this.patchMetadata[moduleFileOrPatchSetPath as ModuleFilePath] = [];
        }
        if (existingPatchMetadata) {
          for (const patchMetadata of existingPatchMetadata) {
            this.patchMetadata[
              moduleFileOrPatchSetPath as ModuleFilePath
            ].unshift(patchMetadata);
          }
        } else if (existingPatchSetMetadata) {
          for (const patchMetadata of existingPatchSetMetadata.patches) {
            this.patchMetadata[
              moduleFileOrPatchSetPath as ModuleFilePath
            ].unshift(patchMetadata);
          }
        } else {
          throw new Error(
            `Could not find patch set metadata or patch metadata for (inserted) patch set path: ${moduleFileOrPatchSetPath}`,
          );
        }
      } else {
        if (!this.patchSetMetadata[newPatchSetPath]) {
          this.patchSetMetadata[newPatchSetPath] = {
            moduleFilePath,
            patchPath,
            patches: [],
            authors: [],
            opTypes: [],
            schemaType,
            lastUpdated: createdAt,
            lastUpdatedBy: author,
          };
        }
        if (existingPatchMetadata) {
          for (const patchMetadata of existingPatchMetadata) {
            this.patchSetMetadata[newPatchSetPath].patches.unshift(
              patchMetadata,
            );
          }
        } else if (existingPatchSetMetadata) {
          for (const patchMetadata of existingPatchSetMetadata.patches.slice()) {
            this.patchSetMetadata[newPatchSetPath].patches.unshift(
              patchMetadata,
            );
            if (patchMetadata.author !== null) {
              this.patchSetMetadata[newPatchSetPath].authors.unshift(
                patchMetadata.author,
              );
            }
            this.patchSetMetadata[newPatchSetPath].opTypes.unshift(
              patchMetadata.opType,
            );
          }
        } else {
          throw new Error(
            `Could not find patch set metadata or patch metadata for (inserted) patch set path: ${moduleFileOrPatchSetPath}`,
          );
        }
      }

      // 3) delete old metadata
      if (moduleFileOrPatchSetPath !== newPatchSetPath) {
        delete this.patchMetadata[moduleFileOrPatchSetPath as ModuleFilePath];
        delete this.patchSetMetadata[
          moduleFileOrPatchSetPath as InternalPatchSetPath
        ];
      }
    }

    // 4) insert new metadata
    if (patchPath.length === 0 || hasPatchMetadata) {
      if (!this.patchMetadata[moduleFilePath]) {
        this.patchMetadata[moduleFilePath] = [];
      }
      this.patchMetadata[moduleFilePath].unshift({
        moduleFilePath,
        patchId,
        author,
        createdAt,
        opType,
        schemaType,
      });
    } else {
      if (!this.patchSetMetadata[newPatchSetPath]) {
        this.patchSetMetadata[newPatchSetPath] = {
          moduleFilePath,
          patchPath,
          patches: [],
          authors: [],
          opTypes: [],
          schemaType: schemaType,
          lastUpdated: createdAt,
          lastUpdatedBy: author,
        };
      }
      if (author !== null) {
        this.patchSetMetadata[newPatchSetPath].authors.unshift(author);
      }
      this.patchSetMetadata[newPatchSetPath].lastUpdatedBy = author;
      this.patchSetMetadata[newPatchSetPath].lastUpdated = createdAt;
      this.patchSetMetadata[newPatchSetPath].opTypes.unshift(opType);
      this.patchSetMetadata[newPatchSetPath].patches.unshift({
        moduleFilePath,
        patchId,
        author,
        createdAt,
        opType,
        schemaType,
      });
    }
    this.orderedInsertKeys.unshift(newPatchSetPath);
  }

  insert(
    moduleFilePath: ModuleFilePath,
    source: Json,
    schema: SerializedSchema,
    op: Operation,
    patchId: PatchId,
    createdAt: IsoDateString,
    author: AuthorId | null,
  ) {
    if (op.op === "file" || op.op === "test") {
      return;
    }
    if (op.op === "replace") {
      this.insertPath(
        moduleFilePath,
        op.path,
        patchId,
        createdAt,
        author,
        op.op,
        schema.type,
      );
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
          this.insertPath(
            moduleFilePath,
            op.path.slice(0, -1),
            patchId,
            createdAt,
            author,
            op.op,
            schema.type,
          );
          if (op.op === "move") {
            this.insertPath(
              moduleFilePath,
              op.from.slice(0, -1),
              patchId,
              createdAt,
              author,
              op.op,
              schema.type,
            );
          }
        } else if (schemaAtPath.type === "record") {
          this.insertPath(
            moduleFilePath,
            op.path,
            patchId,
            createdAt,
            author,
            op.op,
            schema.type,
          );
          if (op.op === "move") {
            this.insertPath(
              moduleFilePath,
              op.from,
              patchId,
              createdAt,
              author,
              op.op,
              schema.type,
            );
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
        this.insertPath(
          moduleFilePath,
          [],
          patchId,
          createdAt,
          author,
          op.op,
          schema.type,
        );
      }
    } else {
      const _unreachable: never = op;
      throw new Error("Unreachable op: " + _unreachable);
    }
  }

  isInserted(patchId: PatchId): boolean {
    return this.insertedPatches.has(patchId);
  }

  serialize(): SerializedPatchSet {
    return this.orderedInsertKeys.map((key) => {
      if (key in this.patchSetMetadata) {
        return this.patchSetMetadata[key];
      } else if (key in this.patchMetadata) {
        const moduleFilePath = key as ModuleFilePath;
        return [moduleFilePath, this.patchMetadata[moduleFilePath]];
      } else {
        throw new Error(
          `Could not find patch set metadata or patch metadata for (inserted) patch set path: ${key}`,
        );
      }
    });
  }
}
