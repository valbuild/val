import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldSchemaError({
  error,
}: {
  path?: SourcePath;
  error: string;
  type?: SerializedSchema["type"] | "module";
}) {
  return (
    <div>
      <div>Schema error: {error}</div>
    </div>
  );
}
