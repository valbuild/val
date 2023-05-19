import { type Source, type SerializedVal } from "@valbuild/lib";
import { type SourcePath } from "@valbuild/lib/src/val";

export type SerializedModuleContent = {
  source: Source;
  schema: SerializedVal;
  id: SourcePath;
};
