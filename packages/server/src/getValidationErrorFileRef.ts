import { ValidationError } from "@valbuild/core";

/**
 * The media path a validation error is about, if it is about media at all.
 *
 * There is no schema in hand here — a `ValidationError` carries only the value
 * it flagged — so the shape is all there is to go on.
 */
export function getValidationErrorFileRef(validationError: ValidationError) {
  const maybePath =
    validationError.value &&
    typeof validationError.value === "object" &&
    "path" in validationError.value &&
    typeof validationError.value.path === "string"
      ? validationError.value.path
      : undefined;

  if (!maybePath) {
    return null;
  }
  return maybePath;
}
