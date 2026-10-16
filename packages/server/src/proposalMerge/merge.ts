import ts from "typescript";
import type { ModuleFilePath, PatchId, SerializedSchema } from "@valbuild/core";
import {
  applyPatch,
  deepClone,
  JSONOps,
  type JSONValue,
  type Operation,
} from "@valbuild/core/patch";
import { pipe, result } from "@valbuild/core/fp";
import { PatchSets, schemaTypesOfPath } from "@valbuild/shared/internal";
import path from "path";
import { insertValJsonEntry, removeValJsonEntry, TSOps } from "../patch/ts/ops";
import { analyzeValModule } from "../patch/ts/valModule";
import {
  codeOf,
  type Files,
  type Project,
  type ProjectModule,
} from "./project";
import {
  diffOps,
  mergeValues,
  setAt,
  valueAt,
  type IsAtomic,
  type Value,
  type ValueConflict,
} from "./threeWay";
import { validateModule } from "./validate";

/**
 * Publishing a proposal as a pull request is merged: valbuild/home
 * `docs/hosted-publishing.md`, step 8.2.
 *
 * Val's half: the two answers that need a schema. Content gets them as files
 * and change ids and carries them out, never looking at a field, a list or a
 * patch set.
 *
 * - {@link mergeFromSite} -- Update from the site: the merge commit `M`.
 * - {@link changesToMove} -- which of the site's pending changes leave the
 *   site when a proposal is merged.
 *
 * `mergeScenarios.test.ts` is their specification.
 */

export type { Project, ProjectModule } from "./project";

/** A field both sides changed since the proposal started. */
export type FieldConflict = {
  kind: "field";
  moduleFilePath: ModuleFilePath;
  path: string[];
  base: JSONValue | undefined;
  site: JSONValue | undefined;
  proposal: JSONValue | undefined;
};

/**
 * Code both sides changed: a component, `val.modules.ts`, or the schema of a
 * `.val.ts` (its code -- everything but `c.define`'s content argument, whose
 * fields merge on their own).
 */
export type CodeConflict = {
  kind: "code";
  file: string;
  base: string | null;
  site: string | null;
  proposal: string | null;
};

/**
 * The schema check: content that merged cleanly and is not valid under the
 * schema the merge ends with -- an entry the site added, say, under a field
 * whose type the proposal changed.
 */
export type InvalidConflict = {
  kind: "invalid";
  moduleFilePath: ModuleFilePath;
  path: string[];
  value: JSONValue | undefined;
  message: string;
};

export type Conflict = FieldConflict | CodeConflict | InvalidConflict;

/** How a conflict is resolved: keep one side, or write it -- as AI or a developer does. */
export type Resolution =
  | ({ moduleFilePath: ModuleFilePath; path: string[] } & (
      | { keep: "site" | "proposal" }
      | { value: JSONValue }
    ))
  | ({ file: string } & ({ keep: "site" | "proposal" } | { text: string }));

export type MergeResult =
  | {
      status: "merged";
      /** `M`'s tree: every file, merged. */
      files: Files;
      /** Code files `M` changed from the site's, which the proposal stages. */
      code: string[];
    }
  | { status: "conflicts"; conflicts: Conflict[] };

/**
 * Update from the site: a three-way merge of where the proposal started
 * (`base`), the site's head and the proposal's last save, written whole.
 * Every conflict needs a resolution, or nothing is merged.
 *
 * File by file. A file that is not a `.val.ts` is code, and merges as a
 * file: changed on one side, that side's; on both, a conflict. A `.val.ts`
 * is code (everything but `c.define`'s content argument) and content, and the
 * two merge apart: the code as a file, the content field by field
 * (`mergeValues`). So a schema the proposal changed and a field the site
 * published in the same file do not conflict. A code conflict in a `.val.ts`
 * is resolved by keeping a side's code -- the content still merges -- or by
 * writing the whole file.
 *
 * Not here: the schema check ({@link schemaCheck}). It needs the merged
 * files' schemas, so whoever can evaluate them -- Val's loader, the builder
 * tab -- runs it on `files` before the merge is committed.
 */
export function mergeFromSite(input: {
  base: Project;
  site: Project;
  proposal: Project;
  resolutions: Resolution[];
}): MergeResult {
  const { base, site, proposal, resolutions } = input;
  const files: Files = {};
  const conflicts: Conflict[] = [];
  const paths = [
    ...new Set([
      ...Object.keys(base.files),
      ...Object.keys(site.files),
      ...Object.keys(proposal.files),
    ]),
  ].sort();
  // A `.jsonValues()` entry is written with its module, never on its own.
  const entryFiles = new Set(
    [base, site, proposal].flatMap((side) =>
      Object.values(side.modules).flatMap((module) =>
        Object.values(module.entries ?? {}),
      ),
    ),
  );

  for (const file of paths) {
    if (entryFiles.has(file)) continue;
    const b = base.files[file] ?? null;
    const s = site.files[file] ?? null;
    const p = proposal.files[file] ?? null;
    const resolution = fileResolution(resolutions, file);
    const codeConflict = (): CodeConflict => ({
      kind: "code",
      file,
      base: b,
      site: s,
      proposal: p,
    });

    if (!file.endsWith(".val.ts")) {
      if (s === b) files[file] = p;
      else if (p === b) files[file] = s;
      else if (resolution) files[file] = resolvedText(resolution, s, p);
      else {
        conflicts.push(codeConflict());
        files[file] = s;
      }
      continue;
    }

    // A .val.ts: whose code, then the content under it.
    const code = (text: string | null) =>
      text === null ? null : codeOf(file, text);
    let side: "site" | "proposal";
    if (code(s) === code(b)) side = "proposal";
    else if (code(p) === code(b)) side = "site";
    else if (resolution && "text" in resolution) {
      files[file] = resolution.text;
      continue;
    } else if (resolution) side = resolution.keep;
    else {
      conflicts.push(codeConflict());
      files[file] = s;
      continue;
    }

    const moduleFilePath = `/${file}` as ModuleFilePath;
    const moduleOf = (project: Project) => project.modules[moduleFilePath];
    const sourceOf = (project: Project): Value => moduleOf(project)?.source;
    const chosen = side === "site" ? site : proposal;
    const text = side === "site" ? s : p;
    if (text === null) {
      // That side deleted the file. Content the other side changed would go
      // with it: that is for a person to decide -- unless they have.
      const other = side === "site" ? p : s;
      if (!resolution && other !== b) {
        conflicts.push(codeConflict());
      }
      files[file] = null;
      for (const project of [base, site, proposal]) {
        for (const entry of Object.values(moduleOf(project)?.entries ?? {})) {
          files[entry] = null;
        }
      }
      continue;
    }
    // What the chosen text holds, which the merge is written over.
    const from: Value = moduleOf(chosen)?.written ?? moduleOf(chosen)?.source;
    const merged = mergeValues(
      sourceOf(base),
      sourceOf(site),
      sourceOf(proposal),
      atomicFor(moduleOf(chosen)?.schema),
    );
    const resolved = resolveContent(moduleFilePath, merged, resolutions);
    conflicts.push(...resolved.unresolved);
    const content = resolved.content;

    const entries = moduleOf(chosen)?.entries;
    if (entries) {
      Object.assign(
        files,
        writeEntries(file, text, chosen.files, entries, from, content, [
          moduleOf(site)?.entries,
          moduleOf(proposal)?.entries,
        ]),
      );
    } else {
      files[file] = writeContent(file, text, from, content);
    }
  }

  if (conflicts.length > 0) return { status: "conflicts", conflicts };
  return {
    status: "merged",
    files,
    code: Object.keys(files).filter((file) => {
      const text = files[file];
      const before = site.files[file] ?? null;
      if (text === null || before === null) return text !== before;
      return codeOf(file, text) !== codeOf(file, before);
    }),
  };
}

/** A change pending on the site, in chain order. */
export type PendingChange = {
  patchId: PatchId;
  moduleFilePath: ModuleFilePath;
  patch: Operation[];
};

/**
 * The site's pending changes that conflict with going from `site` to
 * `merged`, as whole patch sets: each inner list moves together, into a
 * proposal of its own. Everything else stays pending.
 *
 * Patch sets are the Studio's own (`PatchSets`), from the schema the changes
 * were written against; sets that share a change are one, because a change
 * cannot be split. A set moves when, taken as the site's side of a three-way
 * merge with the merged commit as the other, it conflicts (`mergeValues`, so
 * the same value on both sides moves too); or when it no longer applies to
 * the merged commit, or leaves it invalid under the merged schema.
 */
export function changesToMove(input: {
  site: Project;
  merged: Project;
  pending: PendingChange[];
}): PatchId[][] {
  const { site, merged, pending } = input;
  const sets = new PatchSets();
  for (const change of pending) {
    sets.insert(
      change.moduleFilePath,
      site.modules[change.moduleFilePath]?.schema,
      change.patch,
      change.patchId,
      "",
      null,
    );
  }
  const groups = joinSharedChanges(
    sets.serialize().map((set) => set.patches.map((p) => p.patchId)),
  );

  const moves: PatchId[][] = [];
  for (const group of groups) {
    const changes = pending.filter((change) => group.has(change.patchId));
    if (conflictsWithMerge(changes, site, merged)) {
      moves.push(changes.map((change) => change.patchId));
    }
  }
  // In chain order, so the moved proposals are opened in the order the
  // changes were written.
  const order = (ids: PatchId[]) =>
    pending.findIndex((change) => change.patchId === ids[0]);
  return moves.sort((a, b) => order(a) - order(b));
}

// --- the pieces --------------------------------------------------------------

/**
 * A module's merged content with the resolutions written in: each field
 * conflict that has one, and any value written for the schema check (or
 * anywhere else) as given. What is left is what still needs a person.
 */
export function resolveContent(
  moduleFilePath: ModuleFilePath,
  merged: { value: Value; conflicts: ValueConflict[] },
  resolutions: Resolution[],
): { content: Value; unresolved: FieldConflict[] } {
  let content = merged.value;
  const unresolved: FieldConflict[] = [];
  for (const conflict of merged.conflicts) {
    const resolved = fieldResolution(resolutions, moduleFilePath, conflict);
    if (resolved === null) {
      unresolved.push({ kind: "field", moduleFilePath, ...conflict });
    } else {
      content = setAt(content, conflict.path, resolved.value);
    }
  }
  for (const resolution of resolutions) {
    if (
      "moduleFilePath" in resolution &&
      resolution.moduleFilePath === moduleFilePath &&
      "value" in resolution &&
      !merged.conflicts.some((c) => samePath(c.path, resolution.path))
    ) {
      content = setAt(content, resolution.path, resolution.value);
    }
  }
  return { content, unresolved };
}

function conflictsWithMerge(
  changes: PendingChange[],
  site: Project,
  merged: Project,
): boolean {
  const modules = [...new Set(changes.map((change) => change.moduleFilePath))];
  for (const moduleFilePath of modules) {
    const ops = changes
      .filter((change) => change.moduleFilePath === moduleFilePath)
      .flatMap((change) => change.patch)
      .filter((op) => op.op !== "file");
    const before = site.modules[moduleFilePath]?.source;
    const after = merged.modules[moduleFilePath];
    if (before === undefined || after === undefined) return true;
    const written = apply(before, ops);
    if (written === undefined) return true;
    const mergedSource = after.source;
    const atomic = atomicFor(after.schema);
    if (mergeValues(before, written, mergedSource, atomic).conflicts.length) {
      return true;
    }
    // Over the merged commit: it applies, and is as valid as it was.
    const over = apply(mergedSource, ops);
    if (over === undefined) return true;
    const known = new Set(errorPaths(moduleFilePath, after, mergedSource));
    if (
      errorPaths(moduleFilePath, after, over).some((path) => !known.has(path))
    ) {
      return true;
    }
  }
  return false;
}

/** Patch sets that share a change become one: a change is never split. */
function joinSharedChanges(sets: PatchId[][]): Set<PatchId>[] {
  const groups: Set<PatchId>[] = [];
  for (const set of sets) {
    const joined = new Set(set);
    for (const group of groups.filter((g) => set.some((id) => g.has(id)))) {
      for (const id of group) joined.add(id);
      groups.splice(groups.indexOf(group), 1);
    }
    groups.push(joined);
  }
  return groups;
}

function apply(source: Value, ops: Operation[]): Value {
  if (source === undefined) return undefined;
  const applied = applyPatch(deepClone(source), new JSONOps(), ops);
  return result.isOk(applied) ? applied.value : undefined;
}

function errorPaths(
  moduleFilePath: ModuleFilePath,
  module: ProjectModule,
  source: Value,
): string[] {
  return validateModule(moduleFilePath, module, source).map((error) =>
    error.path.join("/"),
  );
}

/**
 * The schema check of a merge: content in `merged` -- the project
 * {@link mergeFromSite} wrote, with its schemas evaluated -- that is invalid
 * under the schema it ends with, leaving out what was already invalid on a
 * side. A conflict, each; a resolution with a value for one is written into
 * the content by the merge, and so is checked here.
 */
export function schemaCheck(
  merged: Project,
  sides: Project[],
): InvalidConflict[] {
  const conflicts: InvalidConflict[] = [];
  for (const [path, module] of Object.entries(merged.modules)) {
    const moduleFilePath = path as ModuleFilePath;
    const known = new Set(
      sides.flatMap((side) => {
        const there = side.modules[moduleFilePath];
        return there ? errorPaths(moduleFilePath, there, there.source) : [];
      }),
    );
    for (const error of validateModule(moduleFilePath, module, module.source)) {
      if (known.has(error.path.join("/"))) continue;
      conflicts.push({
        kind: "invalid",
        moduleFilePath,
        path: error.path,
        value: valueAt(module.source, error.path),
        message: error.message,
      });
    }
  }
  return conflicts;
}

/**
 * The values that merge whole, though they are objects: media (an image's
 * alt text describes that image, not another) and rich text.
 */
const ATOMIC: ReadonlySet<string> = new Set([
  "image",
  "file",
  "video",
  "font",
  "richtext",
]);

/** See {@link ATOMIC}: where this schema holds a value that merges whole. */
export function atomicFor(schema: SerializedSchema | undefined): IsAtomic {
  if (!schema) return () => false;
  return (path) => {
    const types = schemaTypesOfPath(schema, path);
    return [...types].some((type) => ATOMIC.has(type));
  };
}

const tsOps = new TSOps((document) =>
  pipe(
    analyzeValModule(document),
    result.map(({ source }) => source),
  ),
);

/**
 * `content` written into the `.val.ts` `text`, whose content is `from`: as
 * the smallest patch, through the same AST operations a save uses, so what
 * did not change is left exactly as it was.
 */
export function writeContent(
  file: string,
  text: string,
  from: Value,
  content: Value,
): string {
  const ops = diffOps(from, content);
  if (ops.length === 0) return text;
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.ES2015,
    true,
  );
  return printed(unwrap(file, applyPatch(sourceFile, tsOps, ops)));
}

/**
 * A `.jsonValues()` module, written as its files: the `.val.ts` names the
 * entries -- one added gets a `c.json(...)` line, as a save writes it, one
 * removed loses its line -- and each entry is its own `.val.json`. An entry
 * whose content did not change keeps its file's text exactly.
 */
function writeEntries(
  file: string,
  text: string,
  chosenFiles: Files,
  entries: Record<string, string>,
  from: Value,
  content: Value,
  others: (Record<string, string> | null | undefined)[],
): Files {
  const written: Files = {};
  const before = isRecord(from) ? from : {};
  const after = isRecord(content) ? content : {};
  const moduleDir = path.posix.dirname(file);
  let sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.ES2015,
    true,
  );
  for (const key of Object.keys(before)) {
    if (key in after) continue;
    sourceFile = unwrap(file, removeValJsonEntry(sourceFile, [], key));
    written[entries[key]] = null;
  }
  for (const [key, value] of Object.entries(after)) {
    const entryFile =
      entries[key] ??
      others.map((other) => other?.[key]).find((f) => f !== undefined) ??
      path.posix.join(
        moduleDir,
        path.posix.basename(file, ".val.ts"),
        `${key}.val.json`,
      );
    if (!(key in before)) {
      const importPath = `./${path.posix.relative(moduleDir, entryFile)}`;
      sourceFile = unwrap(
        file,
        insertValJsonEntry(sourceFile, [], key, importPath),
      );
    }
    const kept = chosenFiles[entryFile];
    written[entryFile] =
      key in before && diffOps(before[key], value).length === 0 && kept
        ? kept
        : JSON.stringify(value, null, 2);
  }
  written[file] = printed(sourceFile);
  return written;
}

function isRecord(value: Value): value is { [key: string]: JSONValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrap(
  file: string,
  written: result.Result<ts.SourceFile, unknown>,
): ts.SourceFile {
  if (result.isErr(written)) {
    throw new Error(
      `could not write the merge into ${file}: ${String(written.error)}`,
    );
  }
  return written.value;
}

/** As `prepare` prints: TypeScript escapes non-ASCII as \\u sequences. */
function printed(sourceFile: ts.SourceFile): string {
  return unescape(sourceFile.getText(sourceFile).replace(/\\u/g, "%u"));
}

function fileResolution(resolutions: Resolution[], file: string) {
  for (const resolution of resolutions) {
    if ("file" in resolution && resolution.file === file) return resolution;
  }
  return null;
}

function resolvedText(
  resolution: { keep: "site" | "proposal" } | { text: string },
  site: string | null,
  proposal: string | null,
): string | null {
  if ("text" in resolution) return resolution.text;
  return resolution.keep === "site" ? site : proposal;
}

/** A field conflict's resolution, as the value it leaves; `null` when it has none. */
function fieldResolution(
  resolutions: Resolution[],
  moduleFilePath: ModuleFilePath,
  conflict: ValueConflict,
): { value: Value } | null {
  for (const resolution of resolutions) {
    if (
      !("moduleFilePath" in resolution) ||
      resolution.moduleFilePath !== moduleFilePath ||
      !samePath(resolution.path, conflict.path)
    ) {
      continue;
    }
    if ("value" in resolution) return { value: resolution.value };
    return {
      value: resolution.keep === "site" ? conflict.site : conflict.proposal,
    };
  }
  return null;
}

function samePath(a: string[], b: string[]) {
  return a.length === b.length && a.every((key, at) => key === b[at]);
}
