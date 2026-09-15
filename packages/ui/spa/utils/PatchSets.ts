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

/**
 * Is `inner` strictly nested inside the patch set `outer`?
 *
 * A plain `inner.startsWith(outer)` is not enough, and the difference is not
 * cosmetic. The file part of a key is terminated by the '?' delimiter, but the
 * segments of the patch path are not terminated by anything, so a raw prefix
 * test also matches siblings whose *name* merely starts with the same
 * characters: '/p.val.ts?foobar/title' starts with '/p.val.ts?foo', so removing
 * record key "foo" and retitling record key "foobar" would be merged into one
 * patch set.
 *
 * That used to only over-group two unrelated changes in the compare view. Now
 * that patch sets decide what a patch group must contain, it means staging one
 * key silently publishes its similarly-named sibling — so the boundary has to be
 * checked explicitly: '?' when `outer` is a bare module file path, '/' when it
 * already has a patch path.
 */
export function isInsidePatchSetPath(inner: string, outer: string): boolean {
  if (!inner.startsWith(outer)) {
    return false;
  }
  const boundary = inner[outer.length];
  return outer.includes("?") ? boundary === "/" : boundary === "?";
}

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
    opPath: PatchPath,
  ) {
    let newPatchSetPath =
      affectsPatchPath.length > 0
        ? `${moduleFilePath}?${affectsPatchPath.join("/")}`
        : moduleFilePath;
    const pathIndexesThatMustBeMerged: number[] = [];
    // TODO: current implementation is O(n), with isInside it is: O(n x m) - there's room for optimization (Trie?). Just make sure order is maintained and that insert AND then serialize is what we optimize for because the UX will do an insert, then serialize immediately after
    for (let i = this.orderedInsertKeys.length - 1; i >= 0; i--) {
      const currentInsertKey = this.orderedInsertKeys[i];
      if (newPatchSetPath !== currentInsertKey) {
        if (isInsidePatchSetPath(newPatchSetPath, currentInsertKey)) {
          // This new patch set is inside an existing patch set...
          // Use the existing patch set as the new name
          newPatchSetPath = currentInsertKey;
          // Move to new patch set to head
          this.orderedInsertKeys.splice(i, 1);
          this.orderedInsertKeys.unshift(newPatchSetPath);
        } else if (isInsidePatchSetPath(currentInsertKey, newPatchSetPath)) {
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

  /**
   * Insert a whole patch.
   *
   * Takes the patch rather than one op because the de-duplication below is
   * per-*patch*: a patch is either known to this instance or it is not. When this
   * took a single op, callers looped and every call after the first hit the
   * `insertedPatches` guard and returned — so only a patch's first op ever reached
   * a patch set. A patch that touched two places (a `move`, or a `file` op sitting
   * before its source op) was therefore mis-grouped, which is invisible in the
   * compare view but decides what a patch group must contain.
   */
  insert(
    moduleFilePath: ModuleFilePath,
    schema: SerializedSchema | undefined,
    patch: Operation[],
    patchId: PatchId,
    createdAt: IsoDateString,
    author: AuthorId | null,
  ) {
    if (this.insertedPatches.has(patchId)) {
      return;
    }
    // Marked inserted unconditionally, schema or not. An earlier revision of this
    // fix only marked it once a schema was available, so that a patch grouped
    // under the whole-module fallback could be re-inserted later with the real
    // schema. That is no longer this class's problem: `PatchSetChain` invalidates
    // on `schema:init` and a rebuild calls `reset()`, which clears this set — so
    // the fallback is already re-derived from scratch when the schema lands, and a
    // conditional here would only leave the per-patch de-duplication half-applied.
    this.insertedPatches.add(patchId);
    for (const op of patch) {
      this.insertOp(moduleFilePath, schema, op, patchId, createdAt, author);
    }
  }

  private insertOp(
    moduleFilePath: ModuleFilePath,
    schema: SerializedSchema | undefined,
    op: Operation,
    patchId: PatchId,
    createdAt: IsoDateString,
    author: AuthorId | null,
  ) {
    if (!schema) {
      this.insertPath(
        moduleFilePath,
        [],
        patchId,
        createdAt,
        author,
        op.op,
        [],
        op.path,
      );
      return;
    }
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
          op.path,
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
            op.path,
          );
          if (op.op === "move" || op.op === "copy") {
            // `copy` as well as `move`: it does not write the source, but it
            // READS it, so the value it produces depends on every pending edit
            // to that source and on the indices around it.
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
              op.path,
            );
          }
        } else if (
          schemaTypesAtPath.size === 1 &&
          (schemaTypesAtPath.has("record") ||
            // An OBJECT is keyed too: its keys are named rather than
            // positional, so neither `add` (create-or-set, `addToNode` in
            // `@valbuild/core/patch`) nor `remove` (delete the property)
            // disturbs any sibling. Either way the op affects exactly the key
            // it names and nothing else, which is the property this branch
            // needs — unlike an array, where both shift every later index.
            //
            // The studio emits `add` rather than `replace` here on purpose, so
            // that the write survives the key having gone away in the meantime:
            // see `ImageField`'s alt write and
            // `ModuleGallery.handleAltTextChange`, which both say so.
            //
            // That last one is why this branch exists. `s.imageset()`
            // serializes as a record whose ITEM is an object, so editing the
            // alt text of a gallery entry resolves `object` here, hit the throw
            // below, and terminated the whole media module into one patch set —
            // once per keystroke. Staging any one change in that module then
            // dragged every other change in it along, because a patch group has
            // to contain a prefix of each patch set it touches.
            schemaTypesAtPath.has("object") ||
            // A settings SECTION is addressed like a record: its keys are
            // named, and an `add` at ["theme", "accent"] modifies exactly that
            // one. Without this it fell to the throw below — every settings
            // edit terminated the whole module into one patch set, which is why
            // the publish diff said "Settings" where `settingsChangeLabels` has
            // a name for the field. Both sections write `add` this way; see
            // `useWriteAssistantSetting`, which has to create an absent section
            // in a single op.
            schemaTypesAtPath.has("settings"))
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
            op.path,
          );
          if (op.op === "move" || op.op === "copy") {
            // The SOURCE is classified on its own terms, not the
            // destination's. A move out of an array item shifts every later
            // index, so that side has to be the array — exactly as the branch
            // above does for a move whose destination is an array. Only when
            // the source parent is keyed too does `op.from` name the whole of
            // what the op affects.
            //
            // `copy` reaches here as well as `move`. It does not write the
            // source, but the value it produces is read from it, so it depends
            // on every pending edit to that source just as a move does — and
            // `editWouldRestage` in `patchGroups` says so, checking `from` for
            // both. Duplicating a record entry (`useDuplicateRecordEntry`) is
            // the copy that actually ships, and its source went ungrouped.
            const fromParent = op.from.slice(0, -1);
            const fromParentTypes = schemaTypesOfPath(schema, fromParent);
            // ANY possible array parent widens, rather than only an
            // unambiguous one: a discriminated union resolves to every
            // variant's type at once, so a source inside one can be an array
            // here and an object there. Requiring a single type grouped it at
            // the item, which is wrong the moment the array variant is the
            // live one — and the whole array is the safe direction.
            const isPositionalSource = fromParentTypes.has("array");
            const path = isPositionalSource ? fromParent : op.from;
            const schemaTypesAtPath = schemaTypesOfPath(schema, path);
            this.insertPath(
              moduleFilePath,
              path,
              patchId,
              createdAt,
              author,
              op.op,
              Array.from(schemaTypesAtPath),
              op.path,
            );
          }
        } else if (
          schemaTypesAtPath.size === 1 &&
          !(schemaTypesAtPath.has("image") || schemaTypesAtPath.has("file"))
        ) {
          // What is left is a parent this function cannot isolate a key
          // inside. Two different reasons end up here, and the message covers
          // both: a PRIMITIVE cannot hold the key at all, which means the path
          // no longer fits the schema — a genuinely stale patch; and `richtext`
          // can, but its children are positional, so isolating one would let a
          // node insert be staged without the edits whose indices it shifted.
          // Both keep reporting, and the catch below terminates the module,
          // which is the conservative thing to do when we cannot say what a
          // change affects.
          throw new Error(
            `Cannot isolate a patch set for op: '${
              op.op
            }' — no addressable key inside schema type: ${
              schemaTypesAtPath.values().next().value
            }`,
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
            op.path,
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
        [schema.type],
        op.path,
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
          `Could not find patch set metadata or patch metadata for (inserted) patch set path: ${key}`,
        );
      }
    });
  }
}
