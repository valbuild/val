import {
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
  type ValidationError,
} from "@valbuild/core";
import { resolveSchemaSourceFixes } from "../resolveSchemaSourceFixes";
import { partitionValidationErrors } from "./partitionValidationErrors";

/**
 * The errors a user must actually act on.
 *
 * Two passes stand between a schema's complaint and something worth blocking a
 * publish for:
 *
 * - `resolveSchemaSourceFixes` resolves the CROSS-MODULE fixes —
 *   `keyof:check-keys` and `router:check-route` — against the live schema and
 *   source. Unresolved, those arrive as "This error should typically be
 *   processed by Val internally. Seeing this error most likely means you have a
 *   Val version mismatch", which is not something a user can do anything with.
 * - `partitionValidationErrors` drops the fixes the SERVER applies on save:
 *   image and file metadata, remote files, gallery directory checks. Blocking on
 *   those would refuse a publish for something the publish itself repairs.
 *
 * ## Everything that gates on validation must use this
 *
 * That is the whole reason it lives in `validation/` rather than beside one of
 * its callers. There are three: the errors a field shows, the AI flow's check on
 * a proposed patch, and — the one that bites — `system.publish`. A publish gate
 * reading raw errors refuses on `router:check-route` for every route module in
 * the project, which is a Save button that does nothing and says
 * "validation-errors" with no error visible anywhere on screen.
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
