import ts from "typescript";
import { result } from "@valbuild/core/fp";
import { analyzeValModule } from "./patch/ts/valModule";
import { analyzeJsonValuesEntries } from "./patch/ts/jsonValuesModule";
import { resolveExistingJsonPath } from "./patch/jsonValuesPatch";

/**
 * Which `*.val.json` holds a `.jsonValues()` entry's content, given the module's
 * `.val.ts`.
 *
 * Tooling that maps a validation `sourcePath` back to a place in a file needs
 * this: for a jsonValues module the offending value is NOT in the `.val.ts` at
 * all — that file only holds `c.json(() => import("./x.val.json"))` — so a
 * resolver that only ever looks at the `.val.ts` can report the error but not
 * where it lives, which for a record with hundreds of entries is not much of a
 * report.
 *
 * Returns a path relative to the project root (leading slash), or undefined when
 * the module has no such entry (not a jsonValues module, unparseable, or the key
 * is not backed by a `c.json` thunk).
 */
export function findJsonEntryFilePath(
  moduleFilePath: string,
  valTsSourceFile: ts.SourceFile,
  entryKey: string,
): string | undefined {
  let analysis;
  try {
    analysis = analyzeValModule(valTsSourceFile);
  } catch {
    return undefined;
  }
  if (result.isErr(analysis)) {
    return undefined;
  }
  const entry = analyzeJsonValuesEntries(analysis.value.source).get(entryKey);
  if (!entry) {
    return undefined;
  }
  return resolveExistingJsonPath(moduleFilePath, entry.importPath);
}
