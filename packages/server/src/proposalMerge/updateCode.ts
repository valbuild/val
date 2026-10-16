import { createHash } from "crypto";
import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import {
  mergeFromSite,
  schemaCheck,
  type Conflict,
  type Resolution,
} from "./merge";
import { entryFilesOf, type Files, type Project } from "./project";
import {
  sideFiles,
  sideSource,
  type Evaluated,
  type MergeTrees,
  type Side,
} from "@valbuild/shared/internal";

export {
  sideFiles,
  sideSource,
  type Evaluated,
  type EvaluatedModule,
  type MergeTrees,
  type Side,
} from "@valbuild/shared/internal";

/**
 * Update from the site, for a proposal with code (valbuild/home
 * `docs/hosted-publishing.md` step 8.2, slice 1b): Val's server's half.
 *
 * Nothing here runs project code. Content hands over the three trees and each
 * module's Source in each (`merge-trees`); the builder tab evaluates each
 * tree's `val.modules.ts` -- the site's own dependencies, from its vendor
 * layer -- and sends what that gave: each module's schema, the content its
 * text holds, and the errors of its Source under that schema. This does the
 * text, with the TypeScript Val's server already has.
 *
 * In two calls, because the schema check needs the merged tree evaluated too:
 *
 * 1. Without `merged`: the merge `M`, as the files it changes over the site
 *    and each module's content -- for the tab to evaluate -- under an `id`.
 *    Or the conflicts, for a person.
 * 2. With `merged`, the tab's evaluation of that `id`: the schema check, then
 *    what content commits. The merge is made again rather than taken from the
 *    tab, and must come out as the same `id`.
 */

export type UpdateWithCode =
  | { status: "conflicts"; conflicts: Conflict[] }
  | {
      status: "evaluate";
      id: string;
      /** `M`, as the files it changes over the site's; `null` deletes. */
      files: Record<string, string | null>;
      /** Each merged module's content, whose errors the tab reports. */
      sources: Record<ModuleFilePath, JSONValue | null>;
    }
  | {
      /** The evaluation sent is not of this merge: the trees moved, or a resolution did. */
      status: "stale";
    }
  | {
      status: "merged";
      /** What the proposal's commit writes; `null` deletes. */
      files: Record<string, string | null>;
      /** Which of `files` are code, staged to be built. */
      staged: string[];
      /** Each module whose Source or schema the merge leaves other than the site's. */
      modules: Record<
        ModuleFilePath,
        { source: JSONValue; schema: SerializedSchema }
      >;
    };

export function updateWithCode(input: {
  trees: MergeTrees;
  evaluated: Record<Side, Evaluated>;
  resolutions: Resolution[];
  merged?: { id: string; evaluated: Evaluated };
}): UpdateWithCode {
  const { trees, evaluated, resolutions } = input;
  const projectOf = (side: Side): Project => {
    const files = sideFiles(trees, side);
    return {
      files,
      modules: modulesOf(files, evaluated[side], (path) =>
        sideSource(trees, side, path),
      ),
    };
  };
  const base = projectOf("base");
  const site = projectOf("site");
  const proposal = projectOf("proposal");
  const result = mergeFromSite({ base, site, proposal, resolutions });
  if (result.status === "conflicts") return result;

  const changes: Record<string, string | null> = {};
  for (const [path, text] of Object.entries(result.files)) {
    if (text !== (site.files[path] ?? null)) changes[path] = text;
  }
  const id = mergeId(changes, result.modules);
  if (input.merged === undefined) {
    const sources: Record<ModuleFilePath, JSONValue | null> = {};
    for (const [path, content] of Object.entries(result.modules)) {
      sources[path as ModuleFilePath] = content ?? null;
    }
    return { status: "evaluate", id, files: changes, sources };
  }
  if (input.merged.id !== id) return { status: "stale" };

  const mergedFiles: Files = { ...site.files, ...changes };
  const mergedProject: Project = {
    files: mergedFiles,
    modules: modulesOf(
      Object.fromEntries(
        Object.entries(mergedFiles).filter(
          (entry): entry is [string, string] => entry[1] !== null,
        ),
      ),
      input.merged.evaluated,
      (path) => result.modules[path] ?? null,
    ),
  };
  const invalid = schemaCheck(mergedProject, [site, proposal]);
  if (invalid.length > 0) return { status: "conflicts", conflicts: invalid };

  // The paths the proposal held go back to what the merge left -- the site's,
  // often -- so nothing it held before is left standing over the new base.
  const files: Record<string, string | null> = { ...changes };
  for (const path of Object.keys(trees.trees.proposal)) {
    if (!(path in files)) files[path] = mergedFiles[path] ?? null;
  }
  const modules: Record<
    ModuleFilePath,
    { source: JSONValue; schema: SerializedSchema }
  > = {};
  for (const [path, module] of Object.entries(mergedProject.modules)) {
    const moduleFilePath = path as ModuleFilePath;
    const onSite = site.modules[moduleFilePath];
    const touched =
      trees.modules[moduleFilePath]?.proposal !==
      trees.modules[moduleFilePath]?.base;
    if (
      touched ||
      onSite === undefined ||
      !sameJson(onSite.source, module.source) ||
      !sameJson(onSite.schema, module.schema)
    ) {
      modules[moduleFilePath] = {
        source: module.source,
        schema: module.schema,
      };
    }
  }
  return {
    status: "merged",
    files,
    staged: result.code.filter((path) => path in files),
    modules,
  };
}

function modulesOf(
  files: Record<string, string>,
  evaluated: Evaluated,
  sourceOf: (path: ModuleFilePath) => JSONValue | null,
): Project["modules"] {
  const modules: Project["modules"] = {};
  for (const [path, module] of Object.entries(evaluated)) {
    const moduleFilePath = path as ModuleFilePath;
    const text = files[moduleFilePath.slice(1)];
    modules[moduleFilePath] = {
      // A module the index has no Source for is one this tree's code adds:
      // its text is all there is.
      source: sourceOf(moduleFilePath) ?? module.written,
      written: module.written,
      schema: module.schema,
      entries: text === undefined ? null : entryFilesOf(moduleFilePath, text),
      errors: module.errors,
    };
  }
  return modules;
}

/** The merge, named by what it is: the files it changes and the content it writes. */
function mergeId(
  files: Record<string, string | null>,
  modules: Record<ModuleFilePath, unknown>,
): string {
  const sorted = (record: Record<string, unknown>) =>
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key] ?? null]);
  return createHash("sha256")
    .update("val.update-with-code.v1\n")
    .update(JSON.stringify({ files: sorted(files), modules: sorted(modules) }))
    .digest("hex");
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
