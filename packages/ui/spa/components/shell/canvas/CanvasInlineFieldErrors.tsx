import type { ReactNode } from "react";
import type { SourcePath, ValidationError } from "@valbuild/core";
import { FieldErrorList } from "../../FieldErrorList";
import { useValidationErrors } from "../../ValErrorProvider";
import { CanvasInlineToolbarLayer } from "./CanvasInlineRichTextToolbar";
import {
  INLINE_TOOLBAR_ATTRIBUTE,
  type InlineEditLocation,
} from "./placeInlineToolbar";

/**
 * What floats by a text being typed in on the page: its validation errors,
 * and -- for a richtext -- the formatting controls (`toolbar`).
 *
 * One box, placed as one (`CanvasInlineToolbarLayer`, `placeInlineToolbar`):
 * two boxes placed each by itself would both want the room above the text,
 * and one would end up on the other. The errors are the part nearer the
 * text when the box is above it, which is where the eye already is.
 *
 * The errors are the field's own, read as its row in the column reads them
 * (`useValidationErrors`), so the two say the same thing at the same time:
 * there is no second way of validating here. Nothing is drawn for a string
 * with nothing wrong with it.
 */
export function CanvasInlineEditFloat({
  path,
  locate,
  toolbar,
}: {
  path: SourcePath;
  locate: () => InlineEditLocation | null;
  /** The formatting controls, or `null` for a string, which has none. */
  toolbar: ReactNode | null;
}) {
  const errors = useValidationErrors(path);
  if (toolbar === null && errors.length === 0) return null;
  return (
    <CanvasInlineToolbarLayer locate={locate}>
      <div className="flex flex-col items-start gap-1">
        {toolbar}
        <CanvasInlineFieldErrors errors={errors} />
      </div>
    </CanvasInlineToolbarLayer>
  );
}

/**
 * A field's validation errors, by the text on the page they are about.
 *
 * In the Studio's styling -- the list the field's row in the column shows
 * -- on the Studio's floating surface, since the page around it is the
 * customer's and may be any colour at all. What to do about it is right
 * there: the caret is in the text the message is about.
 */
export function CanvasInlineFieldErrors({
  errors,
}: {
  errors: ValidationError[];
}) {
  if (errors.length === 0) return null;
  return (
    <div
      // A press here is not a press elsewhere: it does not end the edit.
      {...{ [INLINE_TOOLBAR_ATTRIBUTE]: "" }}
      role="status"
      aria-live="polite"
      className="max-w-xs rounded-lg border border-border-float bg-bg-float px-2.5 py-1.5 shadow-lg"
      /*
       * Nor does it take the focus: the caret is in the page, and reading
       * the message is no reason to lose it.
       */
      onMouseDown={(event) => event.preventDefault()}
    >
      <FieldErrorList
        validationErrors={errors}
        ariaLabel="Validation errors for the text on the page"
      />
    </div>
  );
}
