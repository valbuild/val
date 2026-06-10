import { SourcePath } from "@valbuild/core";
import { FieldValidationError } from "./FieldValidationError";
import { useValidationErrors } from "./ValErrorProvider";

export function ValidationErrors({ path }: { path: SourcePath }) {
  const validationErrors = useValidationErrors(path) ?? [];
  return <FieldValidationError validationErrors={validationErrors} />;
}
