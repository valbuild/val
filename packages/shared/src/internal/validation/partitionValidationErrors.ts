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
 *   - remote upload/download, and the singular remote check (need a personal
 *     access token + network)
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

/**
 * Whether the Studio leaves this error to the server, which repairs it on
 * save, rather than showing it and holding a publish back for it. One rule
 * for every gate: `val publish` asks the same question, so the CLI does not
 * refuse what the Studio would publish.
 */
export function isRepairedOnSave(error: ValidationError): boolean {
  return isSkippedFix(error);
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
    case "images:upload-remote":
    case "file:add-metadata":
    case "file:check-metadata":
    case "file:upload-remote":
    case "file:download-remote":
    case "file:check-remote":
    case "files:upload-remote":
    case "video:add-metadata": // the Studio writes it on upload; --fix for the rest
    case "video:upload-remote":
    case "video:download-remote":
    case "videos:add-metadata": // as `video:add-metadata`, for a set's entry
    case "videos:upload-remote":
    case "videos:check-unique-folder":
    case "videos:check-all-files":
    case "images:check-unique-folder":
    case "files:check-unique-folder":
    case "images:check-all-files":
    case "files:check-all-files":
    case "view:check-module": // schema is code: nothing for an editor to do
      return true;
    case "images:check-remote":
    case "files:check-remote":
    case "videos:check-remote":
      // A collection KEY that is wrong as a key: a remote URL in a gallery that
      // is not `.remote()`, one that does not parse, one outside the gallery's
      // directory. Unlike the singular `image:check-remote` above (core's "not
      // checked" marker on EVERY remote value, which the server does check),
      // core emits these only when the key is wrong, and nothing repairs that
      // on save -- not the server, not `val validate --fix`. Only a person knows
      // whether the key or the gallery's options are the mistake. Skipping them
      // also took them off the publish gate, so a broken key published unseen.
      return false;
    case "keyof:check-keys":
    case "image:check-gallery":
    case "file:check-gallery":
    case "video:check-gallery":
    case "router:check-route":
    case "locale:check-locale":
    case "router:check-locale-param":
    case "record:fill-keys":
    case "jsonValues:extract-entry":
      // `jsonValues:extract-entry` is an entry inlined in the `.val.ts`. The
      // browser cannot fix it (that means writing a new `*.val.json` and
      // rewriting the module) and saving does not repair it either, so surface
      // it: the message names the command (`val validate --fix`) that does.
      return false;
    case "external:upload":
      // Same shape as `jsonValues:extract-entry` — an entry inlined in a
      // `.val.ts` that belongs elsewhere — and more emphatically not skippable.
      // Fixing it writes to a live store, which is why even the CLI does it only
      // under `val external upload` and never under a blanket `--fix`. Surfacing
      // it is the whole point: someone has to decide.
      return false;
    case "remote:rewrite-host":
      // Reported only by the server's full check (the Studio's Validate page,
      // `val validate`), which asks the ref's host -- never by a schema, so
      // the Studio's own validator never holds one. Were it to, a person has
      // to see it: the host is gone, and nothing on save repoints the ref.
      return false;
    default: {
      // Exhaustiveness check: a new ValidationFix code must add a case above.
      const exhaustive: never = fix;
      void exhaustive;
      return false;
    }
  }
}
