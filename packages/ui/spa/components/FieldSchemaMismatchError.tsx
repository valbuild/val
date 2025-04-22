import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldSchemaMismatchError({
  actualType,
  expectedType,
  path,
}: {
  path: SourcePath;
  actualType: SerializedSchema["type"];
  expectedType: SerializedSchema["type"];
}) {
  return (
    <div id={path}>
      <div>
        Schema mismatch: actual: {actualType} vs expected: {expectedType}{" "}
      </div>
    </div>
  );
}
