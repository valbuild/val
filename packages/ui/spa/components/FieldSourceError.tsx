import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldSourceError({
  error,
  path,
}: {
  path: SourcePath;
  error: string;
  type?: SerializedSchema["type"];
}) {
  return (
    <div id={path}>
      <div className="p-4 rounded bg-bg-error-primary text-text-primary">
        Source error: {error}
      </div>
    </div>
  );
}
