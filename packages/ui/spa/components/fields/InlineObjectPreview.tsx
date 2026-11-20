import { SerializedSchema, SourcePath } from "@valbuild/core";
import { useSourceAtPath } from "../ValFieldProvider";
import { PreviewLoading, PreviewNull } from "../Preview";
import { FieldSourceError } from "../FieldSourceError";
import { inlineParts } from "../../utils/inlineParts";

/**
 * An object (or a discriminated union's variant) shown on ONE line, inside the
 * field list of the object that holds it:
 *
 *     Author  Name Fredrik · Email fredrik@example.com · Role Developer
 *
 * Every value under it, however deep, in schema order, each after its own
 * field name in muted text, joined with `·`. Empty values are left out. The
 * line truncates like any other value in the list.
 *
 * It replaced the nested grid: a field list inside a field list's value cell,
 * which indented one more column per level and turned a three-field
 * `author.person.name` into a card of six lines, the last of them cut off.
 *
 * The values are TEXT, not the per-type `Preview` components, on purpose:
 * those each draw a block, and several blocks cannot share one line that ends
 * in an ellipsis. So an image is its file name and a boolean is Yes / No here,
 * where the field list draws a thumbnail and a checkbox.
 */
export function InlineObjectPreview({
  path,
  schema,
}: {
  path: SourcePath;
  schema: SerializedSchema;
}) {
  const sourceAtPath = useSourceAtPath(path);
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (sourceAtPath.status !== "success") {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  const parts = inlineParts(schema, sourceAtPath.data, null);
  if (parts.length === 0) {
    return (
      <div id={path} className="text-fg-disabled">
        —
      </div>
    );
  }
  return (
    <div id={path} className="truncate">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && (
            <span className="px-1 text-fg-disabled" aria-hidden>
              ·
            </span>
          )}
          {part.label !== null && (
            <span className="text-fg-disabled">{part.label} </span>
          )}
          {part.text}
        </span>
      ))}
    </div>
  );
}
