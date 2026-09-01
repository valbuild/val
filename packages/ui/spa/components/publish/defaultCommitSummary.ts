import type { ModuleFilePath } from "@valbuild/core";

/**
 * The commit summary you get without asking anyone.
 *
 * Publishing must never wait on a model. The box is filled with this the
 * moment the publish popover opens, it is editable straight away, and it is
 * what gets committed unless the user edits it or takes an AI suggestion. It
 * is also the whole story when no AI is configured.
 */

/** How many names to list before falling back to "and N more". */
const MAX_LISTED = 6;

/**
 * A name a non-technical reader recognises, from a module file path.
 *
 * `/content/blogs/page.val.ts` is the router for the `blogs` route, so it is
 * "blogs", not "page" - the same rule the AI prompt has always been given.
 */
export function moduleDisplayName(moduleFilePath: string): string {
  const segments = moduleFilePath.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? moduleFilePath;
  const base = fileName.replace(/\.val\.(ts|js|tsx|jsx)$/, "");
  // A router file is named for its route, which is the folder above it.
  const name =
    base === "page" || base === "index"
      ? (segments[segments.length - 2] ?? base)
      : base;
  const spaced = name.replace(/[-_]+/g, " ").trim();
  if (!spaced) {
    return moduleFilePath;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function buildDefaultCommitSummary(
  moduleFilePaths: readonly ModuleFilePath[] | readonly string[],
): string {
  const names = Array.from(
    new Set(moduleFilePaths.map((path) => moduleDisplayName(path))),
  ).sort((a, b) => a.localeCompare(b));

  if (names.length === 0) {
    return "Update content";
  }
  if (names.length === 1) {
    return `Update ${names[0]}`;
  }
  const listed = names.slice(0, MAX_LISTED).join(", ");
  const remaining = names.length - MAX_LISTED;
  const changed = remaining > 0 ? `${listed} and ${remaining} more` : listed;
  return `Update content in ${names.length} places\n\nChanged: ${changed}`;
}
