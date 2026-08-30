import {
  Internal,
  ModulePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { useSchemaAtPath } from "../components/ValFieldProvider";

/**
 * The module path with its last segment removed, cut out of the ORIGINAL
 * string.
 *
 * Deliberately NOT split-and-rejoin. `splitModulePath` returns segments
 * UNQUOTED and `patchPathToModulePath` re-quotes by guessing from the text, so
 * a record key that merely LOOKS like a number (`"0"`) comes back as the array
 * index `0` and the parent path is wrong. Slicing keeps whatever quoting the
 * path already had, for every key.
 *
 * (`Internal.parentOfSourcePath` still round-trips and so still has that hole —
 * see the TODO on `patchPathToModulePath`. Fixing it there is a core change of
 * its own; this is the lookup that needs to be exact.)
 */
function parentOfModulePath(modulePath: ModulePath): ModulePath {
  let lastSeparator = -1;
  let inQuotes = false;
  for (let i = 0; i < modulePath.length; i++) {
    const char = modulePath[i];
    if (inQuotes) {
      if (char === "\\") {
        i++; // whatever follows is escaped, never a delimiter
      } else if (char === '"') {
        inQuotes = false;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ".") {
      lastSeparator = i;
    }
  }
  if (lastSeparator === -1) {
    return "" as ModulePath;
  }
  return modulePath.slice(0, lastSeparator) as ModulePath;
}

export function useParent(path: SourcePath) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  // The re-join must keep the segments quoted exactly as they came in: every
  // store keys on `?p="testimonials"`, and `.join(".")` produced
  // `?p=testimonials`. The schema lookup happened to tolerate the unquoted
  // form, which is what hid it — the preview lookup does not, so
  // `useRefPreview` found nothing for any container that is not at the module
  // root.
  const maybeParentPath = Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    parentOfModulePath(modulePath),
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
