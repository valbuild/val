import {
  FILE_REF_PROP,
  FILE_REF_SUBTYPE_TAG,
  Internal,
  VAL_EXTENSION,
  type ImageMetadata,
  type SerializedSchema,
  type Source,
} from "@valbuild/core";
import { Patch } from "@valbuild/shared/internal";
import type { ToolName } from "../utils/toolNames";

export type CombinedImageMetadata = ImageMetadata;

type GalleryArgs = {
  filePath: string;
  imageKey: string;
  metadata: CombinedImageMetadata;
};

type RemoveGalleryArgs = {
  filePath: string;
};

export type BuildResult =
  | { kind: "ok"; patch: Patch }
  | { kind: "wrong-tool"; suggestedTool: ToolName; reason: string }
  | { kind: "error"; message: string };

export function buildFileRefValue(
  filePath: string,
  metadata: Record<string, unknown>,
  subtype: "image" | "file",
): Record<string, unknown> {
  return {
    [FILE_REF_PROP]: filePath,
    [VAL_EXTENSION]: "file",
    [FILE_REF_SUBTYPE_TAG]: subtype,
    metadata,
  };
}

export function getSourceAt(
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

export type ResolveResult =
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
export function resolveSerializedSchemaAtPath(
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

export type InlineImgInfo =
  | { kind: "not-allowed" }
  | { kind: "allowed"; remote: boolean };

export function getInlineImgInfo(
  richtextSchema: SerializedSchema,
): InlineImgInfo {
  if (richtextSchema.type !== "richtext") return { kind: "not-allowed" };
  const img = richtextSchema.options?.inline?.img;
  if (!img) return { kind: "not-allowed" };
  if (img === true) return { kind: "allowed", remote: false };
  return { kind: "allowed", remote: img.remote === true };
}

export function isRemoteSchema(schema: SerializedSchema): boolean {
  if (schema.type === "image" || schema.type === "file") {
    return schema.remote === true;
  }
  if (schema.type === "record") {
    return schema.remote === true;
  }
  return false;
}

export function safeParsePatch(patch: unknown[]): BuildResult {
  const parsed = Patch.safeParse(patch);
  if (!parsed.success) {
    return {
      kind: "error",
      message: `Built patch failed schema validation: ${JSON.stringify(parsed.error)}`,
    };
  }
  return { kind: "ok", patch: parsed.data };
}

function checkGallerySchema(
  moduleSchema: SerializedSchema,
): BuildResult | null {
  if (moduleSchema.type === "record" && moduleSchema.mediaType === "images") {
    return null;
  }
  if (moduleSchema.type === "image") {
    return {
      kind: "wrong-tool",
      suggestedTool: "create_patch",
      reason:
        "Module is a plain image field, not an images gallery. Use create_patch with a SessionKey value.",
    };
  }
  if (moduleSchema.type === "richtext") {
    return {
      kind: "wrong-tool",
      suggestedTool: "create_patch",
      reason:
        "Module is a richtext, not an images gallery. Use create_patch with a SessionKey inside a {tag:'img', src: SessionKey} node.",
    };
  }
  return {
    kind: "error",
    message: `Module schema is not an images gallery (expected record with mediaType="images", got '${moduleSchema.type}').`,
  };
}

export function buildImageGalleryPatch(
  args: GalleryArgs,
  moduleSchema: SerializedSchema,
): BuildResult {
  const wrong = checkGallerySchema(moduleSchema);
  if (wrong) return wrong;
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
  return safeParsePatch(patch);
}

export function buildRemoveImageGalleryEntryPatch(
  args: RemoveGalleryArgs,
  moduleSchema: SerializedSchema,
  moduleSource: Source | undefined,
): BuildResult {
  const wrong = checkGallerySchema(moduleSchema);
  if (wrong) return wrong;
  if (
    !moduleSource ||
    typeof moduleSource !== "object" ||
    Array.isArray(moduleSource)
  ) {
    return {
      kind: "error",
      message: `Cannot remove from gallery: module source is not an object.`,
    };
  }
  const entries = moduleSource as Record<string, Source>;
  if (!Object.prototype.hasOwnProperty.call(entries, args.filePath)) {
    const availableKeys = Object.keys(entries);
    const hint =
      availableKeys.length > 0
        ? ` Available entries: ${availableKeys.map((k) => `"${k}"`).join(", ")}.`
        : " The gallery is empty.";
    return {
      kind: "error",
      message: `No gallery entry with file_path "${args.filePath}".${hint}`,
    };
  }
  const remote =
    Internal.remote.splitRemoteRef(args.filePath).status === "success";
  const patch = [
    {
      op: "remove" as const,
      path: [args.filePath],
    },
    {
      op: "file" as const,
      path: [args.filePath],
      filePath: args.filePath,
      value: null,
      remote,
    },
  ];
  return safeParsePatch(patch);
}
