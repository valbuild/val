import {
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import { resolveSchemaSourceFixes } from "@valbuild/shared/internal";
import { partitionValidationErrors } from "../validation/partitionValidationErrors";

/**
 * Resolves cross-module fixes against the live schema/source snapshot, then
 * drops fixes the server applies on save (image/file metadata, remote files,
 * gallery directory checks). Returns only the errors a user must act on.
 *
 * Used by the AI flow on the output of `validatePatchResult` — that path
 * doesn't go through the engine snapshot, so it has to apply the same
 * resolver + partition pipeline directly.
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
  return partitionValidationErrors(resolved).surfaced;
}
