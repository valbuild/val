import {
  Internal,
  ModuleFilePath,
  RecordSchema,
  Schema,
  SelectorSource,
  SourcePath,
} from "@valbuild/core";
import { ValidationError } from "@valbuild/core";

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
): Promise<Record<SourcePath, ValidationError[]>> {
  const out: Record<SourcePath, ValidationError[]> = {};
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
      out[entryPath] = [
        {
          message: `Entry '${key}' is written inline in ${modulePath}, but this record uses .jsonValues(): entry values must live in their own '*.val.json' file, referenced with c.json(() => import("./...")). Run 'val validate --fix' to move it.`,
          value: marker,
          fixes: ["jsonValues:extract-entry"],
        },
      ];
      continue;
    }
    const thunk = Internal.getJsonImport(marker);
    if (!thunk) {
      continue;
    }
    let content: SelectorSource;
    try {
      content = (await thunk()).default as SelectorSource;
    } catch (err) {
      out[entryPath] = [
        {
          message: `Could not load JSON entry '${key}': ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ];
      continue;
    }
    const entryErrors = schema.validateJsonEntryContent(entryPath, content);
    if (entryErrors) {
      for (const [p, errs] of Object.entries(entryErrors)) {
        out[p as SourcePath] = errs;
      }
    }
  }
  return out;
}
