import { type Source, type SerializedSchema } from "@valbuild/core";
import { type SourcePath } from "@valbuild/core/src/val";

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedSchema;
  path: SourcePath;
};
