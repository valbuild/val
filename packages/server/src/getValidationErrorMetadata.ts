import { ValidationError } from "@valbuild/core";

export function getValidationErrorMetadata(validationError: ValidationError) {
  const maybeMetadata =
    validationError.value &&
    typeof validationError.value === "object" &&
    "metadata" in validationError.value &&
    validationError.value.metadata &&
    validationError.value.metadata;
  if (!maybeMetadata) {
    return null;
  }
  return maybeMetadata;
}
