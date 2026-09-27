import type { ModuleFilePath } from "@valbuild/core";

/**
 * The commit message you get without asking anyone.
 *
 * Publishing must never depend on a model. By default nobody is asked for a
 * message at all, and {@link buildDefaultCommitMessage} is what gets committed
 * whenever the AI is not configured, fails, or takes too long. Where the
 * project requires a message it is the placeholder of the box instead — a hint,
 * never a value, so that "required" cannot be satisfied without reading.
 */

/** How many names fit in a title before a count reads better. */
const MAX_NAMED = 3;

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
  // `.val.json` too: JSON entry modules are real module paths, and leaving the
  // extension on leaked "Student.val.json" into publish summaries.
  const base = fileName.replace(/\.val\.(ts|tsx|js|jsx|json)$/, "");
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
  // A few names read better than a count — "Update Home and Blogs" says more
  // than "Update content in 2 places" in fewer words, and is what someone
  // scanning a commit list actually wants.
  if (names.length <= MAX_NAMED) {
    return `Update ${joinNames(names)}`;
  }
  const listed = names.slice(0, MAX_LISTED).join(", ");
  const remaining = names.length - MAX_LISTED;
  const changed = remaining > 0 ? `${listed} and ${remaining} more` : listed;
  return `Update content in ${names.length} places\n\nChanged: ${changed}`;
}

/** How many fields of one module to name in the body before counting. */
const MAX_FIELDS_LISTED = 5;

/** One place a publish changes: a module, and the field within it. */
export type ChangedPlace = {
  moduleFilePath: ModuleFilePath | string;
  /** Empty for the module as a whole. */
  patchPath: readonly string[];
};

/**
 * The commit message for a publish nobody wrote a message for.
 *
 * {@link buildDefaultCommitSummary}'s title, with the places spelled out. A
 * commit that nobody described is read later by someone asking "what did this
 * touch", and a module's display name does not answer that: two modules can
 * share one, and a field is not in it at all. So the exact module file paths
 * and field paths go in — in the title, where a single field changed, since
 * that is the whole story and it fits; in the body otherwise.
 *
 * The AI summary is written for a different reader and keeps its rule against
 * paths. This is the fallback, and a fallback that names things precisely is
 * worth more than one that reads nicely and says less.
 */
export function buildDefaultCommitMessage(
  places: readonly ChangedPlace[],
): string {
  const fieldsByModule = new Map<string, string[][]>();
  for (const place of places) {
    const fields = fieldsByModule.get(place.moduleFilePath) ?? [];
    fields.push([...place.patchPath]);
    fieldsByModule.set(place.moduleFilePath, fields);
  }
  const modules = Array.from(fieldsByModule.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  if (modules.length === 0) {
    return "Update content";
  }
  const fieldNamesOf = (moduleFilePath: string): string[] =>
    outermostFields(fieldsByModule.get(moduleFilePath) ?? []).map((field) =>
      field.join("."),
    );

  if (modules.length === 1) {
    const moduleFilePath = modules[0];
    const fields = fieldNamesOf(moduleFilePath);
    // The module itself changed: there is no field to name, so the path is
    // the precise part and the display name is the readable one.
    if (fields.length === 0 || fields.includes("")) {
      return `Update ${moduleDisplayName(moduleFilePath)}\n\nChanged: ${moduleFilePath}`;
    }
    if (fields.length === 1) {
      return `Update ${fields[0]} in ${moduleFilePath}`;
    }
    return `Update ${moduleDisplayName(moduleFilePath)}\n\nChanged in ${moduleFilePath}: ${listFields(fields)}`;
  }

  const title = buildDefaultCommitSummary(modules).split("\n")[0];
  const lines = modules.slice(0, MAX_LISTED).map((moduleFilePath) => {
    const fields = fieldNamesOf(moduleFilePath).filter((field) => field !== "");
    return fields.length === 0
      ? `- ${moduleFilePath}`
      : `- ${moduleFilePath}: ${listFields(fields)}`;
  });
  const remaining = modules.length - MAX_LISTED;
  if (remaining > 0) {
    lines.push(`- and ${remaining} more`);
  }
  return `${title}\n\nChanged:\n${lines.join("\n")}`;
}

/**
 * The fields to name, with anything inside another changed field dropped.
 *
 * Replacing `hero` and editing `hero.title` is one change to `hero` — naming
 * both reads as two. An empty path is the module itself and swallows the rest.
 */
function outermostFields(fields: string[][]): string[][] {
  const unique = new Map<string, string[]>();
  for (const field of fields) {
    unique.set(JSON.stringify(field), field);
  }
  const all = Array.from(unique.values());
  return all
    .filter(
      (field) =>
        !all.some(
          (other) =>
            other.length < field.length &&
            other.every((segment, i) => field[i] === segment),
        ),
    )
    .sort((a, b) => a.join(".").localeCompare(b.join(".")));
}

function listFields(fields: string[]): string {
  const listed = fields.slice(0, MAX_FIELDS_LISTED).join(", ");
  const remaining = fields.length - MAX_FIELDS_LISTED;
  return remaining > 0 ? `${listed} and ${remaining} more` : listed;
}

/** "A", "A and B", "A, B and C" — no Oxford comma, matching the UI's copy. */
function joinNames(names: string[]): string {
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Whether an AI summary that just arrived may take over the box.
 *
 * Once the user has started writing, it may not — not on this arrival and not
 * on any later one, because `hasEdited` latches. The AI's version is then
 * offered as a suggestion instead of applied, so nobody watches their own
 * sentence get replaced mid-word.
 *
 * The value check is a second lock on the same door: even with the flag
 * somehow clear, a box that no longer holds the untouched default is treated
 * as the user's and left alone.
 */
export function shouldAutoApplyAiSummary(args: {
  /** Latches true on the first keystroke and never clears. */
  hasEdited: boolean;
  currentValue: string;
  defaultSummary: string;
}): boolean {
  if (args.hasEdited) {
    return false;
  }
  return args.currentValue.trim() === args.defaultSummary.trim();
}
