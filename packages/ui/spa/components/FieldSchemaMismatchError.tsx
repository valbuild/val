import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldSchemaMismatchError({
  actualType,
  expectedType,
}: {
  path: SourcePath;
  actualType: SerializedSchema["type"];
  expectedType: SerializedSchema["type"];
}) {
  return (
    <div>
      <div>
        Schema mismatch: actual: {actualType} vs expected: {expectedType}{" "}
      </div>
    </div>
  );
}
