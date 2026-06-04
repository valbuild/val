import {
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import { resolveSchemaSourceFixes } from "@valbuild/shared/internal";

/**
 * Filters a validation errors map down to only blocking errors.
 *
 * - `keyof:check-keys` and `router:check-route` are resolved against the
 *   in-memory schema/source snapshot via the shared resolver: valid
 *   references are dropped, invalid ones surface as plain validation errors.
 * - All other fixes (image/file metadata, remote upload/download, gallery
 *   checks) are non-blocking in the UI — they resolve server-side on save.
 * - Errors without any fixes are always blocking.
 */
export function filterBlockingValidationErrors(
  validationErrors: Record<SourcePath, ValidationError[]>,
  schemas: Record<ModuleFilePath, SerializedSchema> | null,
  sources: Record<ModuleFilePath, Json> | null,
): Record<SourcePath, ValidationError[]> {
  const resolved = resolveSchemaSourceFixes(validationErrors, {
    schemas: schemas ?? {},
    sources: sources ?? {},
  });

  const blocking: Record<SourcePath, ValidationError[]> = {};
  for (const sourcePathS in resolved) {
    const sourcePath = sourcePathS as SourcePath;
    const blockingForPath: ValidationError[] = [];

    for (const error of resolved[sourcePath]) {
      const fixes = error.fixes ?? [];

      if (fixes.length) {
        const canSkip = fixes.every((fix) => {
          if (
            fix === "image:add-metadata" ||
            fix === "image:check-metadata" ||
            fix === "image:upload-remote" ||
            fix === "image:download-remote" ||
            fix === "image:check-remote" ||
            fix === "images:check-remote" ||
            fix === "file:add-metadata" ||
            fix === "file:check-metadata" ||
            fix === "file:upload-remote" ||
            fix === "file:download-remote" ||
            fix === "file:check-remote" ||
            fix === "files:check-remote" ||
            fix === "images:check-unique-folder" ||
            fix === "files:check-unique-folder" ||
            fix === "images:check-all-files" ||
            fix === "files:check-all-files"
          ) {
            return true;
          } else if (
            fix === "keyof:check-keys" ||
            fix === "router:check-route"
          ) {
            // Resolver dropped or rewrote these — any remnant with the fix
            // still attached is unexpected; treat as blocking.
            return false;
          } else {
            const exhaustiveCheck: never = fix;
            console.error(
              `Unknown validation fix '${exhaustiveCheck}' encountered while filtering validation errors. This fix will be treated as blocking.`,
            );
            return false;
          }
        });
        if (canSkip) {
          continue;
        }
      }

      blockingForPath.push(error);
    }

    if (blockingForPath.length > 0) {
      blocking[sourcePath] = blockingForPath;
    }
  }

  return blocking;
}
