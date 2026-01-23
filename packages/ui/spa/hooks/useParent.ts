import {
  Internal,
  ModulePath,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { useSchemaAtPath } from "../components/ValFieldProvider";

export function useParent(path: SourcePath) {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const maybeParentPath = Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.splitModulePath(modulePath).slice(0, -1).join(".") as ModulePath
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
  parentSchemaAtPath: SerializedSchema | undefined
) => maybeParentPath !== path && parentSchemaAtPath?.type === "record";
export const isParentArray = (
  path: SourcePath,
  maybeParentPath: SourcePath,
  parentSchemaAtPath: SerializedSchema | undefined
) => maybeParentPath !== path && parentSchemaAtPath?.type === "array";
export const isRecord = (schema: SerializedSchema | undefined) =>
  schema?.type === "record";
export const isArray = (schema: SerializedSchema | undefined) =>
  schema?.type === "array";
