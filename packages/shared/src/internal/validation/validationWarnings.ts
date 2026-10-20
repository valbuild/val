import type { ValidationFix } from "@valbuild/core";

/**
 * The fixes whose errors are WARNINGS: reported, but never a reason on their
 * own for `val validate` or `val publish` to fail (unless `--strict`).
 *
 * All of them say the same thing: a local file in a project that stores its
 * files remotely (`files: { remote: true }`, or `.remote()`). Nothing is broken
 * -- the site serves the file from `public/` until it is uploaded -- and every
 * project made from a template starts this way, including a hosted one, which
 * has no CLI to upload with. A local file that does not EXIST is still an
 * error; the CLI's handlers check that before reporting a warning.
 *
 * `--fix` is different: asked to upload and unable to (not logged in, no
 * project), `val validate --fix` fails, because it was asked to do something
 * it did not do.
 */
export const WARNING_FIXES = [
  "image:upload-remote",
  "images:upload-remote",
  "file:upload-remote",
  "files:upload-remote",
  "video:upload-remote",
  "videos:upload-remote",
] as const satisfies readonly ValidationFix[];

export type WarningFix = (typeof WARNING_FIXES)[number];

export function isWarningFix(fix: ValidationFix): fix is WarningFix {
  return WARNING_FIXES.some((warningFix) => warningFix === fix);
}

/**
 * Whether an error is a warning: it carries fixes, and every one of them is a
 * {@link WARNING_FIXES} code. An error tagged with any other fix as well is an
 * error, the same rule `isRepairedOnSave` uses.
 */
export function isValidationWarning(error: {
  fixes?: ValidationFix[];
}): boolean {
  const fixes = error.fixes ?? [];
  return fixes.length > 0 && fixes.every(isWarningFix);
}

/**
 * What `val validate` says about a local file in a remote project, once for
 * all of a module's: the CLI groups warnings by message.
 */
export const LOCAL_FILE_IN_REMOTE_PROJECT_WARNING =
  "Local files in a project with remote files. Your site serves them from public/ for now; they move to remote storage when uploaded.";

export const LOCAL_FILE_IN_REMOTE_PROJECT_HINT =
  "val validate --fix uploads them (needs val login)";
