import { SourcePath } from "@valbuild/core";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useShallowSourceAtPath } from "../ValProvider";
import { FieldSourceError } from "../../components/FieldSourceError";

// NB: Cannot update Literal so no LiteralField.tsx

export function LiteralPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, "literal");
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError path={path} error={sourceAtPath.error} type="literal" />
    );
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
