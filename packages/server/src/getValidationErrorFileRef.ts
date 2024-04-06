import { FILE_REF_PROP, ValidationError } from "@valbuild/core";

export function getValidationErrorFileRef(validationError: ValidationError) {
  const maybeRef =
    validationError.value &&
    typeof validationError.value === "object" &&
    FILE_REF_PROP in validationError.value &&
    typeof validationError.value[FILE_REF_PROP] === "string"
      ? validationError.value[FILE_REF_PROP]
      : undefined;

  if (!maybeRef) {
    return null;
  }
  return maybeRef;
}
