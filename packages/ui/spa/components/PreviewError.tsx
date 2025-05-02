import { SourcePath } from "@valbuild/core";

export function PreviewError({ error }: { error: string; path: SourcePath }) {
  return (
    <div className="p-4 text-white bg-bg-error-primary">
      <div>Preview error: {error}</div>
    </div>
  );
}
