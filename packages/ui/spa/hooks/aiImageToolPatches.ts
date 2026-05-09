import {
  FILE_REF_PROP,
  FILE_REF_SUBTYPE_TAG,
  VAL_EXTENSION,
  type ImageMetadata,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";
import type { ToolName } from "../utils/toolNames";

export type CombinedImageMetadata = ImageMetadata;

type FieldArgs = {
  filePath: string;
  imageKey: string;
  patchPath: string[];
  metadata: CombinedImageMetadata;
};

type RichtextArgs = {
  filePath: string;
  imageKey: string;
  patchPath: string[];
  nestedFilePath: string[];
  metadata: CombinedImageMetadata;
};

type GalleryArgs = {
  filePath: string;
  imageKey: string;
  metadata: CombinedImageMetadata;
};

export type BuildResult =
  | { kind: "ok"; patch: Patch }
  | { kind: "wrong-tool"; suggestedTool: ToolName; reason: string }
  | { kind: "error"; message: string };

function buildFileRefValue(
  filePath: string,
  metadata: CombinedImageMetadata,
): Record<string, unknown> {
  return {
    [FILE_REF_PROP]: filePath,
    [VAL_EXTENSION]: "file",
    [FILE_REF_SUBTYPE_TAG]: "image",
    metadata,
  };
}

function getSourceAt(
  source: Source | undefined,
  path: string[],
): Source | undefined {
  let current: Source | undefined = source;
  for (const part of path) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx] as Source | undefined;
    } else if (typeof current === "object") {
      current = (current as Record<string, Source>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

type ResolveResult =
  | { kind: "leaf"; schema: SerializedSchema }
  | { kind: "richtext"; schema: SerializedSchema; remainingPath: string[] }
  | { kind: "gallery-traversed"; schema: SerializedSchema }
  | { kind: "unresolved" };

/**
 * Walks `schema` along `path`, returning a structured result:
 * - `leaf`: walked the full path; resolved schema at the end.
 * - `richtext`: hit a richtext mid-walk; richtext is the resolved schema.
 * - `gallery-traversed`: hit an `s.images()` record and walked past it (i.e. the
 *   path tries to address an entry inside the gallery — a clue the AI should
 *   have used the gallery tool instead).
 * - `unresolved`: the path could not be walked.
 */
function resolveSerializedSchemaAtPath(
  schema: SerializedSchema,
  path: string[],
): ResolveResult {
  let current: SerializedSchema = schema;
  for (let i = 0; i < path.length; i++) {
    const part = path[i];
    if (current.type === "object") {
      const next = current.items[part];
      if (!next) return { kind: "unresolved" };
      current = next;
    } else if (current.type === "array") {
      current = current.item;
    } else if (current.type === "record") {
      if (current.mediaType === "images") {
        return { kind: "gallery-traversed", schema: current };
      }
      current = current.item;
    } else if (current.type === "richtext") {
      return {
        kind: "richtext",
        schema: current,
        remainingPath: path.slice(i),
      };
    } else if (current.type === "union") {
      if (typeof current.key === "string") {
        for (const variant of current.items) {
          const resolved = resolveSerializedSchemaAtPath(
            variant,
            path.slice(i),
          );
          if (resolved.kind !== "unresolved") return resolved;
        }
        return { kind: "unresolved" };
      }
      return { kind: "unresolved" };
    } else {
      return { kind: "unresolved" };
    }
  }
  return { kind: "leaf", schema: current };
}

function describeSchemaForWrongTool(
  schema: SerializedSchema,
):
  | { kind: "field" }
  | { kind: "richtext" }
  | { kind: "gallery" }
  | { kind: "other"; type: string } {
  if (schema.type === "image") return { kind: "field" };
  if (schema.type === "richtext") return { kind: "richtext" };
  if (schema.type === "record" && schema.mediaType === "images") {
    return { kind: "gallery" };
  }
  return { kind: "other", type: schema.type };
}

type InlineImgInfo =
  | { kind: "not-allowed" }
  | { kind: "allowed"; remote: boolean };

function getInlineImgInfo(richtextSchema: SerializedSchema): InlineImgInfo {
  if (richtextSchema.type !== "richtext") return { kind: "not-allowed" };
  const img = richtextSchema.options?.inline?.img;
  if (!img) return { kind: "not-allowed" };
  if (img === true) return { kind: "allowed", remote: false };
  return { kind: "allowed", remote: img.remote === true };
}

function isRemoteSchema(schema: SerializedSchema): boolean {
  if (schema.type === "image" || schema.type === "file") {
    return schema.remote === true;
  }
  if (schema.type === "record") {
    return schema.remote === true;
  }
  return false;
}

function safeParse(patch: unknown[]): BuildResult {
  const parsed = Patch.safeParse(patch);
  if (!parsed.success) {
    return {
      kind: "error",
      message: `Built patch failed schema validation: ${JSON.stringify(parsed.error)}`,
    };
  }
  return { kind: "ok", patch: parsed.data };
}

export function buildImageFieldPatch(
  args: FieldArgs,
  moduleSchema: SerializedSchema,
  moduleSource: Source | undefined,
): BuildResult {
  const resolved = resolveSerializedSchemaAtPath(moduleSchema, args.patchPath);
  if (resolved.kind === "unresolved") {
    return {
      kind: "error",
      message: `Could not resolve schema at patch_path ${JSON.stringify(args.patchPath)}.`,
    };
  }
  if (resolved.kind === "gallery-traversed") {
    return {
      kind: "wrong-tool",
      suggestedTool: "convert_session_image_gallery",
      reason:
        "patch_path points into an image gallery (s.images()). Use convert_session_image_gallery instead — it derives the path from file_path.",
    };
  }
  if (resolved.kind === "richtext") {
    return {
      kind: "wrong-tool",
      suggestedTool: "convert_session_image_richtext",
      reason:
        "patch_path points into a richtext field. Use convert_session_image_richtext instead.",
    };
  }
  const leafSchema = resolved.schema;
  if (leafSchema.type !== "image") {
    return {
      kind: "error",
      message: `Expected an image field at patch_path, got '${leafSchema.type}'.`,
    };
  }

  const existing = getSourceAt(moduleSource, args.patchPath);
  const op: "add" | "replace" =
    existing === undefined || existing === null ? "add" : "replace";
  const refValue = buildFileRefValue(args.filePath, args.metadata);
  const remote = isRemoteSchema(leafSchema);
  const patch = [
    { op, path: args.patchPath, value: refValue },
    {
      op: "file" as const,
      path: args.patchPath,
      filePath: args.filePath,
      value: args.imageKey,
      remote,
      metadata: args.metadata,
    },
  ];
  return safeParse(patch);
}

export function buildImageRichtextPatch(
  args: RichtextArgs,
  moduleSchema: SerializedSchema,
): BuildResult {
  const resolved = resolveSerializedSchemaAtPath(moduleSchema, args.patchPath);
  if (resolved.kind === "unresolved") {
    return {
      kind: "error",
      message: `Could not resolve schema at patch_path ${JSON.stringify(args.patchPath)}.`,
    };
  }
  if (resolved.kind === "gallery-traversed") {
    return {
      kind: "wrong-tool",
      suggestedTool: "convert_session_image_gallery",
      reason:
        "patch_path points into an image gallery, not a richtext. Use convert_session_image_gallery.",
    };
  }
  if (resolved.kind === "leaf") {
    const desc = describeSchemaForWrongTool(resolved.schema);
    if (desc.kind === "field") {
      return {
        kind: "wrong-tool",
        suggestedTool: "convert_session_image_field",
        reason:
          "patch_path points to a plain image field, not inside a richtext. Use convert_session_image_field.",
      };
    }
    return {
      kind: "error",
      message: `Expected richtext on the path, got '${resolved.schema.type}'.`,
    };
  }
  const richtextSchema = resolved.schema;
  const inlineImg = getInlineImgInfo(richtextSchema);
  if (inlineImg.kind === "not-allowed") {
    return {
      kind: "error",
      message:
        "This richtext field does not allow inline images (options.inline.img is not set).",
    };
  }
  const refValue = buildFileRefValue(args.filePath, args.metadata);
  const remote = inlineImg.remote;
  const patch = [
    {
      op: "add" as const,
      path: args.patchPath,
      value: { tag: "img", src: refValue },
    },
    {
      op: "file" as const,
      path: args.patchPath,
      nestedFilePath: args.nestedFilePath,
      filePath: args.filePath,
      value: args.imageKey,
      remote,
      metadata: args.metadata,
    },
  ];
  return safeParse(patch);
}

export function buildImageGalleryPatch(
  args: GalleryArgs,
  moduleSchema: SerializedSchema,
): BuildResult {
  if (moduleSchema.type !== "record" || moduleSchema.mediaType !== "images") {
    if (moduleSchema.type === "image") {
      return {
        kind: "wrong-tool",
        suggestedTool: "convert_session_image_field",
        reason:
          "Module is a plain image field, not an images gallery. Use convert_session_image_field.",
      };
    }
    if (moduleSchema.type === "richtext") {
      return {
        kind: "wrong-tool",
        suggestedTool: "convert_session_image_richtext",
        reason:
          "Module is a richtext, not an images gallery. Use convert_session_image_richtext.",
      };
    }
    return {
      kind: "error",
      message: `Module schema is not an images gallery (expected record with mediaType="images", got '${moduleSchema.type}').`,
    };
  }
  const remote = isRemoteSchema(moduleSchema);
  const patch = [
    {
      op: "add" as const,
      path: [args.filePath],
      value: { ...args.metadata },
    },
    {
      op: "file" as const,
      path: [args.filePath],
      filePath: args.filePath,
      value: args.imageKey,
      remote,
      metadata: args.metadata,
    },
  ];
  return safeParse(patch);
}
