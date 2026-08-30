import { Internal, SerializedSchema, SourcePath } from "@valbuild/core";
import { useSchemaAtPath } from "../components/ValFieldProvider";

export function useParent(path: SourcePath) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  // `splitModulePath` returns UNQUOTED segments, so the re-join must re-quote
  // them (`patchPathToModulePath`), not `.join(".")`: that produced
  // `?p=testimonials` where every store keys on `?p="testimonials"`. The schema
  // lookup happened to tolerate the unquoted form, which is what hid it — the
  // preview lookup does not, so `useRefPreview` found nothing for any container
  // that is not at the module root.
  const maybeParentPath = Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath(
      Internal.splitModulePath(modulePath).slice(0, -1),
    ),
  );
  const parentSchemaAtPath = useSchemaAtPath(maybeParentPath);
  return {
    path: maybeParentPath,
    schema: "data" in parentSchemaAtPath ? parentSchemaAtPath.data : undefined,
  };
}

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
export const isRecord = (schema: SerializedSchema | undefined) =>
  schema?.type === "record" &&
  !(schema.mediaType === "files" || schema.mediaType === "images");
export const isArray = (schema: SerializedSchema | undefined) =>
  schema?.type === "array";
