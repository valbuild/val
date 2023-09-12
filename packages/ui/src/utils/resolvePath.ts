import {
  Internal,
  Json,
  ModuleId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { result } from "@valbuild/core/fp";

export type Modules = Record<
  ModuleId,
  {
    schema: SerializedSchema;
    patches: {
      applied: string[];
      failed?: string[];
    };
    source?: Json;
  }
>;

export function resolvePath(
  sourcePath: SourcePath,
  modules: Record<
    ModuleId,
    {
      schema: SerializedSchema;
      patches: {
        applied: string[];
        failed?: string[];
      };
      source?: Json;
    }
  >
) {
  const [moduleId, modulePath] =
    Internal.splitModuleIdAndModulePath(sourcePath);
  const valModule = modules[moduleId];
  if (valModule?.source) {
    return result.ok(
      Internal.resolvePath(modulePath, valModule.source, valModule.schema) as {
        source: Json;
        schema: SerializedSchema;
      }
    );
  }
  return result.err({
    message: `Module "${moduleId}" has no source`,
  });
}
