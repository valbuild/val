import path from "path";
import type { ModuleFilePath } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import { getValTsSourceFile } from "./valTsSourceFile";
import { setValJsonEntryImportPath } from "./patch/ts/ops";
import { analyzeValModule } from "./patch/ts/valModule";
import { analyzeJsonValuesEntries } from "./patch/ts/jsonValuesModule";
import {
  getNewJsonEntryPaths,
  resolveExistingJsonPath,
} from "./patch/jsonValuesPatch";
import { formatPatchSourceError } from "./ValOps";
import { formatTsOpsError } from "./patch/ts/syntax";

/**
 * Moves ONE `.jsonValues()` entry's `*.val.json` to the path its key derives
 * (`getNewJsonEntryPaths`) and rewrites the entry's `import(...)` specifier to
 * match.
 *
 * This is the fix for the `jsonValues:rename-entry-file` validation error. Like
 * `extractJsonValuesEntry` it is not expressible as a patch (a patch edits one
 * `.val.ts` and cannot move a file), so it writes the files directly, and in the
 * same order for the same reason: the new JSON first, so a failure part-way
 * through never leaves the module pointing at a file that does not exist. The old
 * file is only unlinked once the module no longer refers to it — the worst
 * outcome of a crash mid-way is a stray copy, never a dangling import.
 *
 * Root-only, like the rest of the `.jsonValues()` machinery: the entry is looked
 * up in the module's root record/router object literal.
 */
export function renameJsonValuesEntryFile(
  moduleFilePath: ModuleFilePath,
  rootDir: string,
  entryKey: string,
  sourceFileHandler: ValSourceFileHandler,
): void {
  const { valTsPath, sourceFile } = getValTsSourceFile(
    moduleFilePath,
    rootDir,
    sourceFileHandler,
  );
  const cannot = (reason: string) =>
    Error(
      `Cannot move the file of .jsonValues() entry '${entryKey}' of ${moduleFilePath}: ${reason}`,
    );
  const analysis = analyzeValModule(sourceFile);
  if (result.isErr(analysis)) {
    throw Error(
      `${valTsPath}\n${formatTsOpsError(analysis.error, sourceFile)}`,
    );
  }
  const entry = analyzeJsonValuesEntries(analysis.value.source).get(entryKey);
  if (!entry) {
    throw cannot(
      `it is not a c.json(() => import("...")) entry of the module's root record`,
    );
  }
  const pathsRes = getNewJsonEntryPaths(moduleFilePath, entryKey);
  if (result.isErr(pathsRes)) {
    throw Error(formatPatchSourceError(pathsRes.error));
  }
  const { jsonPath, importPath } = pathsRes.value;
  const currentJsonPath = resolveExistingJsonPath(
    moduleFilePath,
    entry.importPath,
  );
  if (currentJsonPath === jsonPath) {
    // Already canonical. Not an error: the fix is idempotent, so a second pass
    // (or two errors racing on the same entry) is a no-op rather than a failure.
    return;
  }
  const absoluteCurrentJsonPath = path.join(rootDir, currentJsonPath);
  const absoluteJsonPath = path.join(rootDir, jsonPath);
  if (sourceFileHandler.host.fileExists(absoluteJsonPath)) {
    // Refuse rather than clobber, as extractJsonValuesEntry does: the file at
    // the canonical path may be another entry's content (or a copy left by an
    // interrupted earlier run), and overwriting it destroys content no patch
    // can bring back.
    throw cannot(`'${jsonPath}' already exists`);
  }
  const content = sourceFileHandler.host.readFile(absoluteCurrentJsonPath);
  if (content === undefined) {
    throw cannot(`'${currentJsonPath}' does not exist`);
  }
  const updated = setValJsonEntryImportPath(
    sourceFile,
    [],
    entryKey,
    importPath,
  );
  if (result.isErr(updated)) {
    throw Error(`${valTsPath}\n${formatTsOpsError(updated.error, sourceFile)}`);
  }

  // Order matters, see the doc comment: create, then repoint, then unlink.
  sourceFileHandler.writeFile(absoluteJsonPath, content, "utf8");
  sourceFileHandler.writeSourceFile(updated.value);
  sourceFileHandler.host.rmFile(absoluteCurrentJsonPath);
}
