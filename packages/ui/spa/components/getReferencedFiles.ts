import {
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { traverseSchemas } from "./traverseSchemas";
import {
  forEachRichTextImage,
  richTextImageSchema,
} from "../utils/richTextImages";
import { pathNamesGalleryKey } from "../utils/galleryKey";

/** A field pointing into a gallery, and what it holds there. */
export type FileReferrer = {
  sourcePath: SourcePath;
  /** The field's `path`, or `null` for an empty field. */
  path: string | null;
  /** Whether the value carries a draft `patch_id`. */
  hasPatchId: boolean;
};

/**
 * Every image/file field pointing into the gallery `parent` — gallery-backed
 * `s.image()` / `s.file()` fields, and the inline images of a rich text field
 * whose `img` schema is gallery-backed.
 */
export function getFileReferrers(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  parent: ModuleFilePath,
  fileRef?: string, // if provided, only the referrers naming this entry
): FileReferrer[] {
  const results: FileReferrer[] = [];
  const add = (sourcePath: SourcePath, source: unknown) => {
    const media = mediaValueOf(source);
    if (fileRef !== undefined) {
      if (media === null || !pathNamesGalleryKey(media.path, fileRef)) {
        return;
      }
    }
    if (results.some((r) => r.sourcePath === sourcePath)) {
      return;
    }
    results.push({
      sourcePath,
      path: media?.path ?? null,
      hasPatchId: media?.hasPatchId ?? false,
    });
  };
  traverseSchemas(schemas, sources, (sourcePath, schema, source) => {
    if (schema.type === "image" || schema.type === "file") {
      if (schema.referencedModule === parent) {
        add(sourcePath, source);
      }
    } else if (schema.type === "richtext") {
      const img = richTextImageSchema(schema);
      if (img?.referencedModule === parent) {
        forEachRichTextImage(sourcePath, source, add);
      }
    } else if (
      schema.type === "string" ||
      schema.type === "number" ||
      schema.type === "boolean" ||
      schema.type === "literal" ||
      schema.type === "enum" ||
      schema.type === "date" ||
      schema.type === "dateTime" ||
      schema.type === "color" ||
      schema.type === "code" ||
      schema.type === "keyOf" ||
      schema.type === "route" ||
      schema.type === "locale" ||
      // A view holds no source, so it references no file of its own.
      schema.type === "view"
    ) {
      // ignore these
    } else {
      const exhaustiveCheck: never = schema;
      console.error(
        `Could not get referenced files. Unhandled schema type`,
        exhaustiveCheck,
      );
    }
  });
  return results;
}

export function getReferencedFiles(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  sources: Record<ModuleFilePath, Source>,
  parent: ModuleFilePath,
  fileRef?: string, // if provided, filter to only paths whose source names fileRef
): SourcePath[] {
  return getFileReferrers(schemas, sources, parent, fileRef).map(
    (referrer) => referrer.sourcePath,
  );
}

function mediaValueOf(
  source: unknown,
): { path: string; hasPatchId: boolean } | null {
  if (
    typeof source === "object" &&
    source !== null &&
    !Array.isArray(source) &&
    "path" in source &&
    typeof source.path === "string"
  ) {
    return {
      path: source.path,
      hasPatchId: "patch_id" in source && typeof source.patch_id === "string",
    };
  }
  return null;
}
