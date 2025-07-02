import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldSchemaError({
  error,
  path,
}: {
  path?: SourcePath;
  error: string;
  type?: SerializedSchema["type"] | "module";
}) {
  return (
    <div id={path}>
      <div className="p-4 bg-bg-error-primary text-fg-error-primary">
        {error}
      </div>
    </div>
  );
}
