import { SerializedSchema, SourcePath } from "@valbuild/core";

export function FieldLoading({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  path,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type,
}: {
  path: SourcePath;
  type?: SerializedSchema["type"] | "module";
}) {
  return (
    <div className="pt-6">
      <div>Loading...</div>
    </div>
  );
}
