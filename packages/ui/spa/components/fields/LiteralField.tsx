import { SourcePath } from "@valbuild/core";
import { Input } from "../designSystem/input";
import { PreviewNull } from "../../components/Preview";
import { useShallowSourceAtPath } from "../ValFieldProvider";
import { FieldLoading } from "../../components/FieldLoading";
import { FieldNotFound } from "../../components/FieldNotFound";
import { FieldSourceError } from "../../components/FieldSourceError";
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
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (sourceAtPath.status === "not-found") {
    return <FieldNotFound path={path} type="literal" />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <FieldLoading path={path} type="literal" />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  if (compact) {
    // The dense read-only presentation is text, like `StringField`'s: it
    // wraps rather than truncates, so the whole value is on screen.
    return (
      <div
        id={path}
        className="text-sm whitespace-pre-wrap [overflow-wrap:anywhere] opacity-70"
      >
        {sourceAtPath.data}
      </div>
    );
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
