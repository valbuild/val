import { SourcePath } from "@valbuild/core";
import { PreviewLoading, PreviewNull } from "../components/Preview";
import { useShallowSourceAtPath } from "../ValProvider";

// NB: Cannot update Literal so no LiteralField.tsx

export function LiteralPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "literal");
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <div className="truncate">{sourceAtPath.data}</div>;
}
