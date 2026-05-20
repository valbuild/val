import { CircleAlert } from "lucide-react";
import { ValidationError } from "@valbuild/core";
import classNames from "classnames";

/**
 * Shared error-list rendering for fields. Used by:
 *  - `FieldValidationError` (inline below an editor field)
 *  - `ValidationErrors` (the dedicated `/val/errors` page)
 *
 * The look is deliberately the amber/warning palette rather than error-red:
 * it makes the messages visible at a glance without reading as "the system is
 * broken". A 2px amber rail on the left groups all messages for one field
 * together; each message is prefixed with a small `CircleAlert` icon.
 *
 * Render nothing if there are no errors. Callers don't need to gate.
 */
export function FieldErrorList({
  validationErrors,
  ariaLabel = "Validation errors for this field",
  className,
}: {
  validationErrors: ValidationError[];
  ariaLabel?: string;
  className?: string;
}) {
  if (validationErrors.length === 0) {
    return null;
  }
  return (
    <div className={classNames("relative pl-3", className)}>
      <span
        className="absolute left-0 top-1 bottom-1 w-[2px] rounded bg-bg-warning-secondary"
        aria-hidden
      />
      <ul
        className="flex flex-col gap-1.5 text-sm text-fg-warning-primary"
        aria-label={ariaLabel}
      >
        {validationErrors.map((err, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <CircleAlert
              size={13}
              className="mt-[3px] shrink-0 text-fg-warning-primary-alt"
              aria-hidden
            />
            <span>{err.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
