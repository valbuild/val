import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldLoading({}: {
  path: SourcePath;
  type: SerializedSchema["type"] | "module";
}) {
  return (
    <div>
      <div>Loading...</div>
    </div>
  );
}
