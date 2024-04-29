import { FILE_REF_PROP, SourcePath, ValidationError } from ".";
import { isFileRef } from "./isFileRef";

export function partitionFilesAndPureValidationErrors(
  validationErrors: Record<SourcePath, ValidationError[]>
): {
  fileRefs: string[];
  pureValidateErrors: Record<SourcePath, ValidationError[]>;
} {
  const fileRefs: string[] = [];
  const pureValidateErrors: Record<SourcePath, ValidationError[]> = {};

  for (const sourcePathS in validationErrors) {
    const sourcePath = sourcePathS as SourcePath;
    const validationError = validationErrors[sourcePath];
    for (const error of validationError) {
      const value = error.value;
      const isMetaDataError =
        error.fixes &&
        error.fixes.every(
          (fix) =>
            fix === "file:add-metadata" ||
            fix === "file:check-metadata" ||
            fix === "image:add-metadata" ||
            fix === "image:replace-metadata"
        );
      if (isMetaDataError) {
        if (isFileRef(value)) {
          fileRefs.push(value[FILE_REF_PROP]);
          continue;
        } else {
          console.error(
            `Found metadata fixes: ${error.fixes?.join(
              ", "
            )}, but error is not a file nor image`,
            {
              error,
            }
          );
        }
      }
      pureValidateErrors[sourcePath] = (
        pureValidateErrors[sourcePath] || []
      ).concat(error);
    }
  }

  return {
    fileRefs,
    pureValidateErrors,
  };
}
