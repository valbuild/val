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
      <div className="p-4 rounded bg-bg-error-primary text-text-primary">
        {error}
      </div>
    </div>
  );
}
