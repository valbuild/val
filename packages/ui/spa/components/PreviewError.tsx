import { SourcePath } from "@valbuild/core";

export function PreviewError({ error }: { error: string; path: SourcePath }) {
  return (
    <div className="p-4 text-fg-error-primary bg-bg-error-primary">
      <div>Preview error: {error}</div>
    </div>
  );
}
