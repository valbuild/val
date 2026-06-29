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
      // a non-marker entry is already reported by the record-level validation
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
