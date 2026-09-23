import { SourcePath } from "@valbuild/core";
import { Input } from "../designSystem/input";
import { PreviewLoading, PreviewNull } from "../../components/Preview";
import { useShallowSourceAtPath } from "../ValFieldProvider";
import { FieldSourceError } from "../../components/FieldSourceError";
import { LiteralPreview } from "./LiteralPreview";
import { ReadonlyGuard } from "./ReadonlyGuard";

/**
 * A literal, shown as the string it is — and never as something to change.
 *
 * A literal's value IS its schema: `type: s.literal("bento-box")` can only ever
 * hold `"bento-box"`, so there is nothing to edit. It is still a field of its
 * object, though, and an editor looking at the object should see what it says
 * rather than an error. It used to render as "Literal fields are not
 * editable", which read as something broken when it is just a constant.
 *
 * Always read-only, whatever the caller asked: a writable input here would
 * produce a patch that can only fail validation.
 */
export function LiteralField({
  path,
  compact,
}: {
  path: SourcePath;
  compact?: boolean;
}) {
  const sourceAtPath = useShallowSourceAtPath(path, "literal");
  if (compact) {
    // The dense read-only presentation is text, like `StringField`'s.
    return <LiteralPreview path={path} />;
  }
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
    <ReadonlyGuard>
      <div id={path}>
        <Input
          className="pr-6 sm:pr-8 sm:w-[calc(100%-0.5rem)]"
          value={sourceAtPath.data}
          readOnly
        />
      </div>
    </ReadonlyGuard>
  );
}
