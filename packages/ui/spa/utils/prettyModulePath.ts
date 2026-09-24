import { fileLabel } from "../components/shell/shellDataMapping";
import { prettifyFilename } from "./prettifyFilename";

/**
 * A module's path, as something an editor can be shown.
 *
 * An editor does not have a checkout. `/app/blogs/[blog]/page.val.ts` names a
 * file they cannot open, in a language they do not write, and the two parts
 * that carry meaning — which folder it is in and what it is called — are
 * exactly the parts a developer reads past. So a path is never printed raw on
 * a surface an editor uses: it is prettified here, with the same functions the
 * Data panel names its rows with, or it is left out.
 *
 * This is NOT a licence to replace a location with a title. The rule in
 * `core/src/preview.ts` still holds — a location is made of path segments and
 * must hold still while someone types — and these are those segments, spelled
 * for a reader rather than for a compiler. `Content / Authors` is the same
 * location as `/content/authors.val.ts`; `Forfattere` is not.
 *
 * Both functions go through `prettifyFilename`, so Next's route conventions
 * survive: `[blog]` reads `Blog`, `(marketing)` reads `Marketing`, and a
 * catch-all reads `…`.
 */

/** `/content/authors.val.ts` -> `Content / Authors` */
export function prettyModulePath(moduleFilePath: string): string {
  const segments = moduleFilePath.split("/").filter(Boolean);
  if (segments.length === 0) return moduleFilePath;
  return [
    ...segments.slice(0, -1).map(prettifyFilename),
    prettifyFilename(fileLabel(moduleFilePath)),
  ].join(" / ");
}

/**
 * The folders alone: `/content/authors.val.ts` -> `Content`.
 *
 * For the surfaces where the module is already NAMED and the only open
 * question is which of the two `page` modules this is. `null` when the module
 * sits at the root and the trail would be empty — a caller renders nothing
 * rather than an empty pair of brackets.
 */
export function prettyModuleLocation(moduleFilePath: string): string | null {
  const segments = moduleFilePath.split("/").filter(Boolean);
  const folders = segments.slice(0, -1);
  if (folders.length === 0) return null;
  return folders.map(prettifyFilename).join(" / ");
}
