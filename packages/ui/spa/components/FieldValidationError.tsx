import { ValidationError } from "@valbuild/core";
import { FieldErrorList } from "./FieldErrorList";

/**
 * Inline error display rendered below a field in the editor.
 *
 * The visual style is owned by `FieldErrorList` and is shared with the
 * `/val/errors` page so the same field reads identically in both views.
 */
export function FieldValidationError({
  validationErrors,
}: {
  validationErrors: ValidationError[];
}) {
  if (validationErrors.length === 0) {
    return null;
  }
  return (
    <div className="w-full pt-2">
      <FieldErrorList validationErrors={validationErrors} />
    </div>
  );
}
