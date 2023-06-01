import { type Source, type SerializedSchema } from "@valbuild/lib";
import { type SourcePath } from "@valbuild/lib/src/val";

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedSchema;
  path: SourcePath;
};
