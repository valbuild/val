import type {
  SourcePath,
  ValidationError,
  ValidationFix,
} from "@valbuild/core";

/**
 * Partition validation errors by whether the UI should surface them.
 *
 * `skipped` errors carry only fix codes the user can't (or shouldn't) act on
 * in the browser:
 *   - image/file metadata checks (need to read bytes from disk)
 *   - remote upload/download/check (need a personal access token + network)
 *   - gallery directory uniqueness + untracked-files checks (need fs traversal)
 *
 * The server (ValOps + createFixPatch) resolves all of these automatically on
 * save, and the CLI's `runValidation` does the same. So the user never needs
 * to see them in the studio — but we keep them in the `skipped` partition,
 * not dropped, so we can later surface a "N fixes pending — saving will
 * repair them" badge or wire up an explicit "fix all" affordance without
 * having to plumb the data back in.
 *
 * `keyof:check-keys` and `router:check-route` are surfaced if they reach
 * this function — they're meant to be resolved upfront by the shared
 * `resolveSchemaSourceFixes`. A remnant here means resolution didn't run
 * for some reason; the user-facing "Invalid key/route" message is more
 * useful than silent hiding.
 */
export function partitionValidationErrors(
  validationErrors: Record<SourcePath, ValidationError[]>,
): {
  surfaced: Record<SourcePath, ValidationError[]>;
  skipped: Record<SourcePath, ValidationError[]>;
} {
  const surfaced: Record<SourcePath, ValidationError[]> = {};
  const skipped: Record<SourcePath, ValidationError[]> = {};
  for (const sourcePathS in validationErrors) {
    const sourcePath = sourcePathS as SourcePath;
    for (const error of validationErrors[sourcePath]) {
      if (isSkippedFix(error)) {
        (skipped[sourcePath] ??= []).push(error);
      } else {
        (surfaced[sourcePath] ??= []).push(error);
      }
    }
  }
  return { surfaced, skipped };
}

function isSkippedFix(error: ValidationError): boolean {
  const fixes = error.fixes ?? [];
  if (fixes.length === 0) return false;
  // Skip iff EVERY fix on the error is in the skip set — an error tagged
  // with both a surfaceable and a skippable fix must still be shown.
  return fixes.every(isSkippableFixCode);
}

function isSkippableFixCode(fix: ValidationFix): boolean {
  switch (fix) {
    case "image:add-metadata":
    case "image:check-metadata":
    case "image:upload-remote":
    case "image:download-remote":
    case "image:check-remote":
    case "images:check-remote":
    case "file:add-metadata":
    case "file:check-metadata":
    case "file:upload-remote":
    case "file:download-remote":
    case "file:check-remote":
    case "files:check-remote":
    case "images:check-unique-folder":
    case "files:check-unique-folder":
    case "images:check-all-files":
    case "files:check-all-files":
      return true;
    case "keyof:check-keys":
    case "router:check-route":
      return false;
    default: {
      // Exhaustiveness check: a new ValidationFix code must add a case above.
      const exhaustive: never = fix;
      void exhaustive;
      return false;
    }
  }
}
