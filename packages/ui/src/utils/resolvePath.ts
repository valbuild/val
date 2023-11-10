import {
  ApiTreeResponse,
  Internal,
  Json,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";

export type Modules = ApiTreeResponse["modules"];

export function resolvePath(sourcePath: SourcePath, modules: Modules) {
  const [moduleId, modulePath] =
    Internal.splitModuleIdAndModulePath(sourcePath);
  const valModule = modules[moduleId];
  if (!valModule?.source) {
    return result.err({
      message: `Module "${moduleId}" has no source`,
    });
  }
  if (!valModule?.schema) {
    return result.err({
      message: `Module "${moduleId}" has no schema`,
    });
  }
  return result.ok(
    Internal.resolvePath(modulePath, valModule.source, valModule.schema) as {
      source: Json;
      schema: SerializedSchema;
    }
  );
}
