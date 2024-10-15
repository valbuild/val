import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldSourceError({
  error,
}: {
  path: SourcePath;
  error: string;
  type: SerializedSchema["type"];
}) {
  return (
    <div>
      <div>Source error: {error}</div>
    </div>
  );
}
