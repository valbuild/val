import { SourcePath } from "@valbuild/core";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useShallowSourceAtPath } from "../ValFieldProvider";
import { FieldSourceError } from "../../components/FieldSourceError";

// The value of a literal IS its schema, so nothing here writes. See
// `LiteralField` for how it is shown in the editor.

export function LiteralPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "literal");
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return (
    <div id={path} className="truncate">
      {sourceAtPath.data}
    </div>
  );
}
