import type { ValidationFix } from "@valbuild/core";

/**
 * The fixes the Studio's full check offers a **Fix** button for.
 *
 * Each is one `createFixPatch` can build without a disk: it reads a file's
 * bytes through `FixFiles`, or needs no bytes at all. The server refuses any
 * other code on `/validate/fix`, and the Studio shows those errors with the
 * command to run instead of a button — so a code is added here when its fix
 * can run in http mode and on the platform, not before. See
 * `docs/plans/studio-validate.md`, "Order of work".
 */
export const STUDIO_FIXES = [
  "image:add-metadata",
  "image:check-metadata",
  "file:add-metadata",
  "file:check-metadata",
  "video:add-metadata",
  "videos:add-metadata",
  "view:check-module",
] as const satisfies readonly ValidationFix[];

export type StudioFix = (typeof STUDIO_FIXES)[number];

export function isStudioFix(fix: ValidationFix): fix is StudioFix {
  return STUDIO_FIXES.some((studioFix) => studioFix === fix);
}
