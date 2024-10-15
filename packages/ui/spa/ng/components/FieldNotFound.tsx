import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldNotFound({}: {
  path: SourcePath;
  type: SerializedSchema["type"] | "module";
}) {
  return (
    <div>
      <div>Not found</div>
    </div>
  );
}
