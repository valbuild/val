import type { ModuleFilePath, SourcePath } from "@valbuild/core";
import { moduleDisplayName } from "./defaultCommitSummary";

/**
 * What changed, small enough to put in a prompt.
 *
 * The old commit-summary endpoint sent every changed source file twice — the
 * previous and the patched text — and diffed them server-side. Fixing one typo
 * in a large module uploaded that whole module twice, and on a brought key that
 * is the user's money. It also handed the model the wrong material: a text diff
 * of TypeScript, with a prompt telling it not to mention file paths or
 * identifiers.
 *
 * This sends field paths and their before/after values instead — the facts a
 * sentence like "the hero heading changed from X to Y" actually needs — capped
 * so a large publish stays a small prompt.
 */

/** Longest before/after value to include, per field. */
const MAX_VALUE_CHARS = 240;

/** Most fields to describe before falling back to counting the rest. */
const MAX_FIELDS = 40;

export type FieldChange = {
  sourcePath: SourcePath;
  moduleFilePath: ModuleFilePath;
  /** Dot-separated field path within the module, empty for the module root. */
  fieldPath: string;
  schemaType: string | undefined;
  before: unknown;
  after: unknown;
};

/**
 * A value as the model should see it: short, and honest about being short.
 *
 * Media and other structures are described rather than dumped — a base64 data
 * URL or a whole rich-text tree would blow the cap and tell the model nothing
 * it can put in a sentence.
 */
export function describeValue(value: unknown): string {
  if (value === undefined) {
    return "(not set)";
  }
  if (value === null) {
    return "(empty)";
  }
  if (typeof value === "string") {
    return truncate(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `(list of ${value.length})`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Media is a plain object with a `path`; the path is the useful part and
    // the rest is metadata nobody writes a commit message about.
    if (typeof record["path"] === "string") {
      return `(file ${truncate(record["path"], 80)})`;
    }
    const keys = Object.keys(record);
    return `(fields: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? ", …" : ""})`;
  }
  return "(value)";
}

function truncate(text: string, max = MAX_VALUE_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) {
    return collapsed;
  }
  return `${collapsed.slice(0, max)}… (${collapsed.length} characters in total)`;
}

/**
 * Renders the changes as the prompt the model is given.
 *
 * Grouped by module so the model can see which page each change belongs to,
 * and truncated as a whole so a 500-field publish does not become a 500-line
 * prompt — past the cap it says how many more there were, which is enough to
 * write "and other changes across N pages".
 */
export function renderChangeDescription(changes: FieldChange[]): string {
  if (changes.length === 0) {
    return "No changes.";
  }
  const shown = changes.slice(0, MAX_FIELDS);
  const byModule = new Map<ModuleFilePath, FieldChange[]>();
  for (const change of shown) {
    const existing = byModule.get(change.moduleFilePath);
    if (existing) {
      existing.push(change);
    } else {
      byModule.set(change.moduleFilePath, [change]);
    }
  }

  const lines: string[] = [];
  for (const [moduleFilePath, moduleChanges] of byModule) {
    lines.push(`## ${moduleDisplayName(moduleFilePath)}`);
    for (const change of moduleChanges) {
      const field = change.fieldPath || "(the whole entry)";
      const type = change.schemaType ? ` [${change.schemaType}]` : "";
      lines.push(`- ${field}${type}`);
      lines.push(`  before: ${describeValue(change.before)}`);
      lines.push(`  after:  ${describeValue(change.after)}`);
    }
    lines.push("");
  }

  const remaining = changes.length - shown.length;
  if (remaining > 0) {
    lines.push(
      `(${remaining} further ${remaining === 1 ? "change" : "changes"} not listed)`,
    );
  }
  return lines.join("\n").trim();
}
