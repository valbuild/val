import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldLoading({}: {
  path: SourcePath;
  type?: SerializedSchema["type"] | "module";
}) {
  return (
    <div className="pt-6">
      <div>Loading...</div>
    </div>
  );
}
