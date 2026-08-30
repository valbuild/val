import type { SerializedSchema, Source } from "@valbuild/core";
import { emptyOf } from "../emptyOf";
import {
  getSourceAt,
  resolveSerializedSchemaAtPath,
  safeParsePatch,
  type BuildResult,
} from "./aiImageToolPatches";
import type { ToolName } from "./toolNames";

type OpDecision =
  | {
      kind: "ok";
      op: "add" | "replace";
      /**
       * What the destination's parent is, so a caller can tell an overwrite from
       * an insert.
       *
       * `add` into a record REPLACES an existing key, while `add` at an array
       * index inserts before it — same op, and only one of them destroys
       * anything.
       */
      parent: "record" | "array" | "object" | "module";
    }
  | { kind: "wrong-tool"; suggestedTool: ToolName; reason: string }
  | { kind: "error"; message: string };

/**
 * Decides whether the duplicate/empty operation should produce an "add" or
 * "replace" JSON patch op by inspecting the destination's *parent* schema.
 *
 * - array / record parent → "add" (creating a new slot)
 * - object parent → "replace" (slot exists by schema definition)
 * - empty path → "replace" (overwriting the whole module)
 * - richtext / gallery parent → not supported; redirect to the right tool
 */
const GALLERY_REDIRECT: Extract<OpDecision, { kind: "wrong-tool" }> = {
  kind: "wrong-tool",
  suggestedTool: "add_session_image_to_gallery",
  reason:
    "Destination is a media gallery (s.images() / s.files()). Gallery entries are keyed by file path and carry a file on disk, so they cannot be created with a plain patch. Use add_session_image_to_gallery.",
};

/** An `s.images()` / `s.files()` record: a gallery, not an ordinary record. */
function isGallery(schema: SerializedSchema): boolean {
  return schema.type === "record" && schema.mediaType !== undefined;
}

function decideOp(
  moduleSchema: SerializedSchema,
  destinationPath: string[],
): OpDecision {
  // The DESTINATION itself, checked before its parent: `["gallery"]` resolves
  // its parent to the enclosing object and would otherwise look like an
  // ordinary `replace` that overwrites a whole gallery.
  const destination = resolveSerializedSchemaAtPath(
    moduleSchema,
    destinationPath,
  );
  if (destination.kind === "gallery-traversed") {
    return GALLERY_REDIRECT;
  }
  if (destination.kind === "richtext") {
    return {
      kind: "wrong-tool",
      suggestedTool: "create_patch",
      reason:
        "Destination is a richtext value. duplicate_source and empty_at_path do not handle richtext edits.",
    };
  }
  if (destination.kind === "leaf") {
    if (isGallery(destination.schema)) {
      return GALLERY_REDIRECT;
    }
    // A richtext value the path lands exactly ON resolves as a leaf, not as
    // `kind: "richtext"` (which only fires when the walk continues INTO it).
    if (destination.schema.type === "richtext") {
      return {
        kind: "wrong-tool",
        suggestedTool: "create_patch",
        reason:
          "Destination is a richtext value. duplicate_source and empty_at_path do not handle richtext edits.",
      };
    }
  }

  if (destinationPath.length === 0) {
    return { kind: "ok", op: "replace", parent: "module" };
  }
  const parent = resolveSerializedSchemaAtPath(
    moduleSchema,
    destinationPath.slice(0, -1),
  );
  if (parent.kind === "unresolved") {
    return {
      kind: "error",
      message: `Destination parent path ${JSON.stringify(
        destinationPath.slice(0, -1),
      )} does not resolve in this module's schema.`,
    };
  }
  if (parent.kind === "richtext") {
    return {
      kind: "wrong-tool",
      suggestedTool: "create_patch",
      reason:
        "Destination is inside a richtext value. duplicate_source and empty_at_path do not handle richtext edits.",
    };
  }
  // `gallery-traversed` means the walk stepped INTO a gallery, so the
  // destination is a gallery entry; `isGallery` catches the case where the
  // parent IS the gallery and the destination is a new entry key in it.
  if (parent.kind === "gallery-traversed" || isGallery(parent.schema)) {
    return GALLERY_REDIRECT;
  }
  const schema = parent.schema;
  if (schema.type === "array" || schema.type === "record") {
    return { kind: "ok", op: "add", parent: schema.type };
  }
  if (schema.type === "object") {
    return { kind: "ok", op: "replace", parent: "object" };
  }
  return {
    kind: "error",
    message: `Destination parent has schema type "${schema.type}" — cannot use duplicate_source/empty_at_path here. Use create_patch instead.`,
  };
}

export function buildDuplicatePatch(
  args: { sourcePath: string[]; destinationPath: string[] },
  moduleSchema: SerializedSchema,
  moduleSource: Source | undefined,
): BuildResult {
  const value = getSourceAt(moduleSource, args.sourcePath);
  if (value === undefined) {
    return {
      kind: "error",
      message: `Source path ${JSON.stringify(
        args.sourcePath,
      )} does not exist in the module. Use get_source to inspect the current contents.`,
    };
  }
  const decision = decideOp(moduleSchema, args.destinationPath);
  if (decision.kind === "wrong-tool") {
    return {
      kind: "wrong-tool",
      suggestedTool: decision.suggestedTool,
      reason: decision.reason,
    };
  }
  if (decision.kind === "error") {
    return { kind: "error", message: decision.message };
  }
  const occupied = refuseOccupiedRecordKey(
    decision.parent,
    moduleSource,
    args.destinationPath,
  );
  if (occupied) {
    return occupied;
  }
  return safeParsePatch([
    {
      op: decision.op,
      path: args.destinationPath,
      value,
    },
  ]);
}

/**
 * Refuse to write over an existing record entry.
 *
 * `add` into a record replaces whatever is at that key, so duplicating or
 * scaffolding onto an occupied key silently destroys the entry that was there.
 * A caller guessing at keys — an agent especially — hits this by accident, and
 * nothing downstream reports it: the patch is valid, the content stays valid,
 * and an entry is simply gone.
 *
 * Only records. An array `add` inserts before the index rather than replacing
 * it, and an object's fields exist by definition, so `replace` on one is the
 * whole point rather than a mistake.
 */
function refuseOccupiedRecordKey(
  parent: "record" | "array" | "object" | "module",
  moduleSource: Source | undefined,
  destinationPath: string[],
): { kind: "error"; message: string } | null {
  if (parent !== "record") {
    return null;
  }
  if (getSourceAt(moduleSource, destinationPath) === undefined) {
    return null;
  }
  const key = destinationPath[destinationPath.length - 1];
  return {
    kind: "error",
    message: `Destination key ${JSON.stringify(
      key,
    )} already exists, and writing to it would replace the entry that is there. Pick a key that is free -- get_record_keys lists the ones in use -- or use create_patch if you meant to change the existing entry.`,
  };
}

export function buildEmptyAtPathPatch(
  args: { destinationPath: string[] },
  moduleSchema: SerializedSchema,
  // Required, not optional: the occupied-key check below is the only thing
  // standing between "scaffold an entry" and "delete the entry that was there",
  // and an optional argument is one a caller forgets.
  moduleSource: Source | undefined,
): BuildResult {
  let destinationSchema: SerializedSchema;
  if (args.destinationPath.length === 0) {
    destinationSchema = moduleSchema;
  } else {
    const result = resolveSerializedSchemaAtPath(
      moduleSchema,
      args.destinationPath,
    );
    if (result.kind === "unresolved") {
      return {
        kind: "error",
        message: `Destination path ${JSON.stringify(
          args.destinationPath,
        )} does not resolve in this module's schema.`,
      };
    }
    if (result.kind === "richtext") {
      return {
        kind: "wrong-tool",
        suggestedTool: "create_patch",
        reason:
          "Destination is a richtext value. Use create_patch to build richtext content.",
      };
    }
    if (result.kind === "gallery-traversed") {
      return {
        kind: "wrong-tool",
        suggestedTool: "add_session_image_to_gallery",
        reason:
          "Destination is inside an images gallery. Use add_session_image_to_gallery to add entries.",
      };
    }
    destinationSchema = result.schema;
  }
  const decision = decideOp(moduleSchema, args.destinationPath);
  if (decision.kind === "wrong-tool") {
    return {
      kind: "wrong-tool",
      suggestedTool: decision.suggestedTool,
      reason: decision.reason,
    };
  }
  if (decision.kind === "error") {
    return { kind: "error", message: decision.message };
  }
  const occupied = refuseOccupiedRecordKey(
    decision.parent,
    moduleSource,
    args.destinationPath,
  );
  if (occupied) {
    return occupied;
  }
  const value = emptyOf(destinationSchema);
  return safeParsePatch([
    {
      op: decision.op,
      path: args.destinationPath,
      value,
    },
  ]);
}

/**
 * What kind of container a path points at.
 *
 * `gallery` and `richtext` are called out separately from `record`/`array`
 * because the two callers disagree about them: `count_entries` can count either,
 * `get_record_keys` documents that it refuses both.
 */
export type ContainerKind =
  | "array"
  | "record"
  | "object"
  | "gallery"
  | "richtext";

export type DescribeContainerResult =
  | { kind: "ok"; container: ContainerKind; value: Source }
  | {
      kind: "error";
      /**
       * Whether the path is not there at all, or is there but holds something
       * that has no entries.
       *
       * The distinction is not cosmetic: a caller that maps these onto its own
       * error codes has to tell "go and look for this path" apart from "the
       * path is right, its type is not", and only the second is worth a retry
       * with a different tool.
       */
      reason: "missing" | "not-a-container";
      message: string;
    };

/**
 * Classifies the value at `path` using the SCHEMA, not just its runtime shape.
 *
 * The runtime shape is not enough: an `s.image()`/`s.file()` source, a richtext
 * node and a union variant are all plain objects at runtime, so classifying by
 * `typeof` alone let `get_record_keys` list a file ref's `_ref`/`_type` internals
 * or a richtext node's `tag`/`children` as if they were record keys.
 */
export function describeContainerAtPath(
  moduleSchema: SerializedSchema,
  moduleSource: Source | undefined,
  path: string[],
): DescribeContainerResult {
  const value = getSourceAt(moduleSource, path);
  if (value === undefined) {
    return {
      kind: "error",
      reason: "missing",
      message: `Path ${JSON.stringify(
        path,
      )} does not exist in the module source. Use get_source to inspect the current contents.`,
    };
  }
  const resolved = resolveSerializedSchemaAtPath(moduleSchema, path);
  if (resolved.kind === "unresolved") {
    return {
      kind: "error",
      reason: "missing",
      message: `Path ${JSON.stringify(
        path,
      )} does not resolve in this module's schema.`,
    };
  }
  if (resolved.kind === "richtext") {
    // Mid-richtext: the path addresses a node inside the richtext value, whose
    // internals (tag, children, ...) are not entries.
    return {
      kind: "error",
      reason: "not-a-container",
      message: `Path ${JSON.stringify(
        path,
      )} points inside a richtext value, which has no entries to count or list.`,
    };
  }
  if (resolved.kind === "gallery-traversed") {
    return {
      kind: "error",
      reason: "not-a-container",
      message: `Path ${JSON.stringify(
        path,
      )} points inside a gallery entry, which has no entries to count or list.`,
    };
  }
  const schema = resolved.schema;
  if (schema.type === "richtext") {
    if (!Array.isArray(value)) {
      return {
        kind: "error",
        reason: "not-a-container",
        message: `Path ${JSON.stringify(
          path,
        )} is a richtext value but its source is not a block array.`,
      };
    }
    return { kind: "ok", container: "richtext", value };
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return {
        kind: "error",
        reason: "not-a-container",
        message: `Path ${JSON.stringify(
          path,
        )} is an array in the schema but its source is not an array.`,
      };
    }
    return { kind: "ok", container: "array", value };
  }
  if (schema.type === "record" || schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {
        kind: "error",
        reason: "not-a-container",
        message: `Path ${JSON.stringify(path)} points to a ${
          value === null
            ? "null"
            : Array.isArray(value)
              ? "array"
              : typeof value
        } value, which has no entries to count or list.`,
      };
    }
    return {
      kind: "ok",
      container:
        schema.type === "record"
          ? isGallery(schema)
            ? "gallery"
            : "record"
          : "object",
      value,
    };
  }
  // image / file / union / string / number / boolean / date / literal / keyOf /
  // route: not containers, whatever their runtime shape looks like.
  return {
    kind: "error",
    reason: "not-a-container",
    message: `Path ${JSON.stringify(path)} points to a "${
      schema.type
    }" value, which has no entries to count or list.`,
  };
}
