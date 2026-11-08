import type { SerializedSchema, SourcePath } from "@valbuild/core";

/*
 * What a path's schema, or its parent's, is: apart from `useParent` so that
 * what is decided from them can be called outside React (`keyOfScanTarget`).
 */

export const isParentRecord = (
  path: SourcePath,
  maybeParentPath: SourcePath,
  parentSchemaAtPath: SerializedSchema | undefined,
) => maybeParentPath !== path && parentSchemaAtPath?.type === "record";
export const isParentArray = (
  path: SourcePath,
  maybeParentPath: SourcePath,
  parentSchemaAtPath: SerializedSchema | undefined,
) => maybeParentPath !== path && parentSchemaAtPath?.type === "array";
// Any media collection — images, files or videos — is a gallery, not a
// record: listing them by name was how a new kind of collection got missed.
export const isRecord = (schema: SerializedSchema | undefined) =>
  schema?.type === "record" && schema.mediaType === undefined;
export const isArray = (schema: SerializedSchema | undefined) =>
  schema?.type === "array";
