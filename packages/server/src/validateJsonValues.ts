import {
  Internal,
  ModuleFilePath,
  RecordSchema,
  Schema,
  SelectorSource,
  SourcePath,
} from "@valbuild/core";
import { ValidationError } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import {
  getNewJsonEntryPaths,
  resolveExistingJsonPath,
} from "./patch/jsonValuesPatch";

/**
 * Validates the content of every `.jsonValues()` entry in a module by loading
 * each backing `*.val.json` (via its lazy import thunk) and checking it against
 * the record's item schema.
 *
 * The record-level `executeValidate` only asserts the marker shape — content
 * validation is deferred (the content isn't inlined). This performs that
 * deferred deep validation server-side. Every loadable entry is validated;
 * validation is allowed to be slower at scale, so a sha-keyed skip-cache is left
 * as a later optimization.
 *
 * Entries without a runtime import thunk (transport markers / draft entries
 * whose content lives in a patch) are skipped here — their content is validated
 * where it is loaded (the single-entry fetch path).
 *
 * ROOT-ONLY BY CONTRACT: only a module whose root schema is a `.jsonValues()`
 * record is visited. Nested `.jsonValues()` records are rejected up front as
 * module errors (see `findNestedJsonValuesRecords`), so they can never reach
 * here — if that guard is ever relaxed, this must become a recursive visitor or
 * nested entries silently get no content validation at all.
 */
export async function validateJsonValuesEntries(
  schema: Schema<SelectorSource>,
  source: unknown,
  modulePath: ModuleFilePath,
  /**
   * The `import(...)` specifier of every `c.json(...)` entry, keyed by entry key,
   * read out of the module's `.val.ts` (see `analyzeJsonValuesEntries`). Enables
   * the canonical-path check below.
   *
   * It has to come from the AST, not from the runtime: the loaded marker only
   * carries the thunk, and `thunk.toString()` gives whatever the bundler rewrote
   * the specifier to (a chunk id in production), so a runtime-derived check would
   * pass unbundled and silently break where it matters.
   *
   * `undefined` when the caller has no way to reach the source file. The
   * canonical-path check is then SKIPPED — see the callers: `Service` (the
   * `val validate` / CI path, which does the check) threads it in; `ValOps` (the
   * Studio path) deliberately does not, because the only route to the `.val.ts`
   * there is `getSourceFile`, an uncached network roundtrip per module in hosted
   * mode, and the Studio cannot apply the fix anyway (it moves a file AND
   * rewrites the module). The Studio never PRODUCES a non-canonical path either:
   * every entry it writes goes through `getNewJsonEntryPaths`.
   */
  entryImportPaths?: ReadonlyMap<string, string>,
): Promise<Record<SourcePath, ValidationError[]>> {
  const out: Record<SourcePath, ValidationError[]> = {};
  // Append, never assign: one entry can collect BOTH a path error (below) and a
  // content error at the same source path, and the author needs to see both.
  const addErrors = (path: SourcePath, errors: ValidationError[]) => {
    out[path] = (out[path] || []).concat(errors);
  };
  if (!(schema instanceof RecordSchema)) {
    return out;
  }
  if (!schema["executeSerialize"]().jsonValues) {
    return out;
  }
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return out;
  }
  for (const [key, marker] of Object.entries(source)) {
    const entryPath = Internal.createValPathOfItem(
      modulePath as string as SourcePath,
      key,
    );
    if (!entryPath) {
      continue;
    }
    if (!Internal.isJson(marker)) {
      // A value written INLINE in the `.val.ts` instead of `c.json(() => import(...))`.
      //
      // The record-level validation checks it against the item schema (so bad
      // content is still reported), but it cannot report the inlining itself:
      // the Studio substitutes loaded entry content in place of the marker
      // before validating, so from `executeValidate`'s perspective a loaded
      // entry and a hand-authored one look identical. Here the source is the
      // module as it is on disk, where a non-marker can only be inlined.
      addErrors(entryPath, [
        {
          message: `Entry '${key}' is written inline in ${modulePath}, but this record uses .jsonValues(): entry values must live in their own '*.val.json' file, referenced with c.json(() => import("./...")). Run 'val validate --fix' to move it.`,
          value: marker,
          fixes: ["jsonValues:extract-entry"],
        },
      ]);
      continue;
    }
    const thunk = Internal.getJsonImport(marker);
    if (!thunk) {
      continue;
    }
    const pathError = entryImportPaths
      ? canonicalPathError(modulePath, key, entryImportPaths)
      : undefined;
    if (pathError) {
      addErrors(entryPath, [pathError]);
    }
    let content: SelectorSource;
    try {
      content = (await thunk()).default as SelectorSource;
    } catch (err) {
      addErrors(entryPath, [
        {
          message: `Could not load JSON entry '${key}': ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ]);
      continue;
    }
    const entryErrors = schema.validateJsonEntryContent(entryPath, content);
    if (entryErrors) {
      for (const [p, errs] of Object.entries(entryErrors)) {
        addErrors(p as SourcePath, errs);
      }
    }
  }
  return out;
}

/**
 * The key↔file mapping of a `.jsonValues()` record is CANONICAL: the file is
 * named after the entry key, under a folder named after the `.val.ts`. Every
 * write derives the path that way (`getNewJsonEntryPaths` — used by the commit
 * flow and by the `jsonValues:extract-entry` fix), but nothing used to check
 * that what is already in the module agrees. An entry could point at any file in
 * the project and validate, so the mapping was a convention the tooling followed
 * and the source was free to contradict — the one place where "the key tells you
 * the file" stopped being true.
 */
function canonicalPathError(
  modulePath: ModuleFilePath,
  key: string,
  entryImportPaths: ReadonlyMap<string, string>,
): ValidationError | undefined {
  const importPath = entryImportPaths.get(key);
  if (importPath === undefined) {
    // The key has a thunk at runtime but no `c.json(() => import("..."))` in the
    // `.val.ts` we were handed: a draft entry whose content lives in a patch, or
    // a thunk built some other way. Nothing to compare against.
    return undefined;
  }
  const expected = getNewJsonEntryPaths(modulePath, key);
  if (result.isErr(expected)) {
    // The key itself cannot be turned into a path (empty, or escapes the
    // module's folder). That is reported by the commit flow, which is the only
    // place it can do damage; here there is simply nothing to compare against.
    return undefined;
  }
  const actualJsonPath = resolveExistingJsonPath(modulePath, importPath);
  if (actualJsonPath === expected.value.jsonPath) {
    return undefined;
  }
  return {
    message: `Entry '${key}' of ${modulePath} loads '${importPath}', but a .jsonValues() entry's file path is derived from its key: it must be '${expected.value.importPath}' (${expected.value.jsonPath}). Run 'val validate --fix' to move it.`,
    fixes: ["jsonValues:rename-entry-file"],
  };
}
