import type { ModuleFilePath } from "@valbuild/core";
import ts from "typescript";
import { result } from "@valbuild/core/fp";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import { getSyntheticContainingPath } from "./getSyntheticContainingPath";
import { analyzeValModule } from "./patch/ts/valModule";
import { analyzeJsonValuesEntries } from "./patch/ts/jsonValuesModule";

/**
 * Resolves and parses the `.val.ts` (or `.js`/`.tsx`/`.jsx`) behind a
 * `ModuleFilePath`.
 *
 * The extension juggling is not cosmetic: a `ModuleFilePath` always names the
 * `.val.ts` even when the file on disk is `.val.js`, so the path is handed to
 * `ts.resolveModuleName` extensionless (via `resolveSourceModulePath`) and TS
 * picks the one that exists. Throws if it cannot be resolved or read — a val
 * module that got as far as being loaded always has a source file, so a failure
 * here means something is wrong with the project, not with the module.
 */
export function getValTsSourceFile(
  moduleFilePath: ModuleFilePath,
  rootDir: string,
  sourceFileHandler: ValSourceFileHandler,
): { valTsPath: string; sourceFile: ts.SourceFile } {
  const valTsPath = sourceFileHandler.resolveSourceModulePath(
    getSyntheticContainingPath(rootDir),
    `.${moduleFilePath
      .replace(".val.ts", ".val")
      .replace(".val.js", ".val")
      .replace(".val.jsx", ".val")
      .replace(".val.tsx", ".val")}`,
  );
  const sourceFile = sourceFileHandler.getSourceFile(valTsPath);
  if (!sourceFile) {
    throw Error(`Source file ${valTsPath} not found`);
  }
  return { valTsPath, sourceFile };
}

/**
 * The `import(...)` specifier of every `c.json(...)` entry of a module, keyed by
 * entry key, read out of the `.val.ts` on disk.
 *
 * Feeds the canonical-path check in `validateJsonValuesEntries`, which cannot use
 * the runtime thunk: a bundler rewrites the specifier to a chunk id, so a
 * runtime-derived check passes unbundled and silently breaks in production.
 *
 * `undefined` means "could not look" (unresolvable or unparseable `.val.ts`), and
 * the caller skips the check rather than reporting a phantom mismatch. In
 * practice this does not happen for a module that reached validation: it was
 * loaded and its schema serialized, so the file exists and parses. Any real
 * syntax problem is reported by the module loader, not swallowed here.
 */
export function readJsonValuesEntryImportPaths(
  moduleFilePath: ModuleFilePath,
  rootDir: string,
  sourceFileHandler: ValSourceFileHandler,
): ReadonlyMap<string, string> | undefined {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = getValTsSourceFile(
      moduleFilePath,
      rootDir,
      sourceFileHandler,
    ).sourceFile;
  } catch {
    return undefined;
  }
  let analysis;
  try {
    analysis = analyzeValModule(sourceFile);
  } catch {
    return undefined;
  }
  if (result.isErr(analysis)) {
    return undefined;
  }
  const importPaths = new Map<string, string>();
  analyzeJsonValuesEntries(analysis.value.source).forEach((entry, key) => {
    importPaths.set(key, entry.importPath);
  });
  return importPaths;
}
