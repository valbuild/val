import { SourcePath, ValidationError } from "@valbuild/core";

export function isParentError(
  path: SourcePath,
  validationErrors: Record<SourcePath, ValidationError[]>,
) {
  for (const errorPath in validationErrors) {
    if (errorPath.startsWith(path)) {
      return true;
    }
  }
  return false;
}
