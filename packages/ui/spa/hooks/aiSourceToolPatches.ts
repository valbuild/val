import type { SerializedSchema, Source } from "@valbuild/core";
import { emptyOf } from "../components/fields/emptyOf";
import {
  getSourceAt,
  resolveSerializedSchemaAtPath,
  safeParsePatch,
  type BuildResult,
} from "./aiImageToolPatches";
import type { ToolName } from "../utils/toolNames";

type OpDecision =
  | { kind: "ok"; op: "add" | "replace" }
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
function decideOp(
  moduleSchema: SerializedSchema,
  destinationPath: string[],
): OpDecision {
  if (destinationPath.length === 0) {
    return { kind: "ok", op: "replace" };
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
  if (parent.kind === "gallery-traversed") {
    return {
      kind: "wrong-tool",
      suggestedTool: "add_session_image_to_gallery",
      reason:
        "Destination is inside an images gallery (s.images()). Use add_session_image_to_gallery to add entries.",
    };
  }
  const schema = parent.schema;
  if (schema.type === "array" || schema.type === "record") {
    return { kind: "ok", op: "add" };
  }
  if (schema.type === "object") {
    return { kind: "ok", op: "replace" };
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
  return safeParsePatch([
    {
      op: decision.op,
      path: args.destinationPath,
      value,
    },
  ]);
}

export function buildEmptyAtPathPatch(
  args: { destinationPath: string[] },
  moduleSchema: SerializedSchema,
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
  const value = emptyOf(destinationSchema);
  return safeParsePatch([
    {
      op: decision.op,
      path: args.destinationPath,
      value,
    },
  ]);
}

export type ContainerKind = "array" | "record" | "object";

export type DescribeContainerResult =
  | { kind: "ok"; container: ContainerKind; value: Source }
  | { kind: "error"; message: string };

/**
 * Walks the schema at `path` to discriminate record vs object (they look the
 * same at runtime). Arrays are recognized from the source value itself.
 * Used by count_entries and get_record_keys.
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
      message: `Path ${JSON.stringify(
        path,
      )} does not exist in the module source. Use get_source to inspect the current contents.`,
    };
  }
  if (Array.isArray(value)) {
    return { kind: "ok", container: "array", value };
  }
  if (value === null || typeof value !== "object") {
    return {
      kind: "error",
      message: `Path ${JSON.stringify(
        path,
      )} points to a ${value === null ? "null" : typeof value} value, which has no entries to count or list.`,
    };
  }
  // Object-like at runtime. Distinguish record vs object via schema.
  let schemaKind: ContainerKind = "object";
  if (path.length === 0) {
    if (moduleSchema.type === "record") schemaKind = "record";
    else if (moduleSchema.type === "object") schemaKind = "object";
    else schemaKind = "object";
  } else {
    const resolved = resolveSerializedSchemaAtPath(moduleSchema, path);
    if (resolved.kind === "leaf") {
      if (resolved.schema.type === "record") schemaKind = "record";
      else if (resolved.schema.type === "object") schemaKind = "object";
    }
    // For richtext / gallery-traversed / unresolved we fall through with the
    // value (richtext nodes are objects too) and report kind: "object".
  }
  return { kind: "ok", container: schemaKind, value };
}
