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
      <div className="p-4 bg-bg-error-primary text-text-error-primary">
        {error}
      </div>
    </div>
  );
}
