import type {
  ModuleFilePath,
  Schema,
  SelectorSource,
  SerializedSchema,
} from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import {
  atomicFor,
  resolveContent,
  writeContent,
  type Conflict,
  type Resolution,
} from "./merge";
import { validateWith } from "./validate";
import { mergeValues, setAt, valueAt, type Value } from "./threeWay";

/**
 * Update from the site when only content changed (valbuild/home
 * `docs/hosted-publishing.md` step 8.2, slice 1a): the proposal staged no code
 * and the site still serves the build the proposal stands on. Then all three
 * sides share one schema -- the running build's -- so the merge needs no
 * project loaded, which is what lets Val's server at a proposal's address run
 * it (it cannot evaluate a `.val.ts`).
 *
 * The same rules as {@link mergeFromSite}, module by module: field by field,
 * the same value on both sides a conflict, media and rich text whole. Content
 * hands over each module the proposal saved, as it was where the proposal
 * started, as the site has it, and as the proposal saved it; the merge is
 * written into the proposal's own `.val.ts` text with the same AST operations
 * a save uses.
 *
 * Not here: a `.jsonValues()` record both sides changed. Its Source in content's
 * index holds only the entries a commit touched, so it cannot be merged from
 * the index; that waits for the full merge, and is answered as such.
 */

export type ModuleToMerge = {
  /** Where the proposal started; `null` when the module did not exist. */
  base: JSONValue | null;
  /** The site's head. */
  site: JSONValue | null;
  /** The proposal's last save. */
  proposal: JSONValue | null;
  /** The proposal's saved `.val.ts`, which the merge is written into. */
  text: string;
};

export type ContentMergeResult =
  | {
      status: "merged";
      /** Each merged `.val.ts`, by path from the project root. */
      files: Record<string, string>;
      /** Each merged module's Source and schema, as a save sends them. */
      modules: Record<
        ModuleFilePath,
        { source: JSONValue | null; schema: SerializedSchema }
      >;
    }
  | { status: "conflicts"; conflicts: Conflict[] }
  | {
      /** What this merge cannot do yet: see the note on this file. */
      status: "needs-full-merge";
      modules: ModuleFilePath[];
    };

export function mergeContent(input: {
  modules: Record<ModuleFilePath, ModuleToMerge>;
  /** The running build's schemas: the same on all three sides here. */
  schemas: Record<ModuleFilePath, Schema<SelectorSource>>;
  resolutions: Resolution[];
}): ContentMergeResult {
  const conflicts: Conflict[] = [];
  const files: Record<string, string> = {};
  const modules: Record<
    ModuleFilePath,
    { source: JSONValue | null; schema: SerializedSchema }
  > = {};
  const needsFullMerge: ModuleFilePath[] = [];

  for (const path of Object.keys(input.modules).sort()) {
    const moduleFilePath = path as ModuleFilePath;
    const { base, site, proposal, text } = input.modules[moduleFilePath];
    const schema = input.schemas[moduleFilePath];
    if (!schema) {
      // The build has no such module: its code changed, so this is not a
      // content-only update.
      needsFullMerge.push(moduleFilePath);
      continue;
    }
    const serialized = schema["executeSerialize"]();
    const orUndefined = (value: JSONValue | null): Value => value ?? undefined;
    const merged = mergeValues(
      orUndefined(base),
      orUndefined(site),
      orUndefined(proposal),
      atomicFor(serialized),
    );
    if (
      merged.conflicts.length > 0 &&
      serialized.type === "record" &&
      serialized.jsonValues
    ) {
      needsFullMerge.push(moduleFilePath);
      continue;
    }
    const resolved = resolveContent(moduleFilePath, merged, input.resolutions);
    conflicts.push(...resolved.unresolved);
    if (resolved.unresolved.length > 0) continue;

    // The schema check, under the one schema there is: what was already
    // invalid on a side is not the merge's doing.
    const known = new Set(
      [site, proposal].flatMap((side) =>
        validateWith(schema, moduleFilePath, orUndefined(side)).map((e) =>
          e.path.join("/"),
        ),
      ),
    );
    let content = resolved.content;
    for (const error of validateWith(schema, moduleFilePath, content)) {
      if (known.has(error.path.join("/"))) continue;
      const written = input.resolutions.find(
        (r) =>
          "moduleFilePath" in r &&
          r.moduleFilePath === moduleFilePath &&
          "value" in r &&
          r.path.join("/") === error.path.join("/"),
      );
      if (written && "value" in written) {
        content = setAt(content, error.path, written.value);
        continue;
      }
      conflicts.push({
        kind: "invalid",
        moduleFilePath,
        path: error.path,
        value: valueAt(content, error.path),
        message: error.message,
      });
    }

    const file = moduleFilePath.slice(1);
    files[file] = writeContent(file, text, orUndefined(proposal), content);
    modules[moduleFilePath] = { source: content ?? null, schema: serialized };
  }

  if (needsFullMerge.length > 0) {
    return { status: "needs-full-merge", modules: needsFullMerge };
  }
  if (conflicts.length > 0) return { status: "conflicts", conflicts };
  return { status: "merged", files, modules };
}
