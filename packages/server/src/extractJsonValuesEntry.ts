import path from "path";
import type { Json, ModuleFilePath } from "@valbuild/core";
import ts from "typescript";
import { result } from "@valbuild/core/fp";
import { PatchError } from "@valbuild/core/patch";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import { getSyntheticContainingPath } from "./getSyntheticContainingPath";
import { insertValJsonEntry, removeValJsonEntry } from "./patch/ts/ops";
import { getNewJsonEntryPaths } from "./patch/jsonValuesPatch";
import { formatPatchSourceError } from "./ValOps";
import {
  flatMapErrors,
  formatSyntaxError,
  type ValSyntaxErrorTree,
} from "./patch/ts/syntax";

/**
 * The two files an extraction touches, as text — nothing written yet.
 *
 * Both paths are project-relative in the `ModuleFilePath` style (a leading
 * slash), because that is what the callers already hold and what
 * {@link getNewJsonEntryPaths} derives. Join them onto the project root to get
 * somewhere to write.
 */
export type JsonValuesEntryExtraction = {
  /** The `*.val.json` to CREATE. It must not already exist — see the note below. */
  jsonPath: string;
  jsonContent: string;
  /** The `.val.ts` to rewrite, and its complete new text. */
  valTsPath: string;
  valTsContent: string;
};

/**
 * Works out what moving ONE inline `.jsonValues()` entry into its own
 * `*.val.json` would change, without changing anything.
 *
 * This is the whole fix for `jsonValues:extract-entry`, minus the writing. It
 * is split out because the two callers cannot share a way of applying it: the
 * CLI writes both files ({@link extractJsonValuesEntry}), while the editor has
 * to hand the same two changes back as a `WorkspaceEdit` so they go through the
 * undo stack and respect an unsaved buffer. Anything that lived in only one of
 * those would be a fix that behaves differently depending on where it was
 * invoked from, which is exactly the drift `codeActions.ts` exists to prevent.
 *
 * It does NOT check whether `jsonPath` already exists: that needs a filesystem,
 * and the editor's answer ("is there a buffer or a file here?") is not the
 * CLI's. Every caller must check before writing — overwriting an unrelated file
 * is not a fix.
 *
 * Root-only, like the rest of the `.jsonValues()` machinery: the entry is looked
 * up in the module's root record/router object literal.
 */
export function planJsonValuesEntryExtraction({
  moduleFilePath,
  entryKey,
  content,
  valTsPath,
  valTsText,
}: {
  moduleFilePath: ModuleFilePath;
  entryKey: string;
  /** The entry's value, as it is written inline in the `.val.ts`. */
  content: Json;
  /** Where the `.val.ts` lives, for error messages. */
  valTsPath: string;
  /** Its text — the editor's version of it, where there is an editor. */
  valTsText: string;
}): result.Result<JsonValuesEntryExtraction, string> {
  const pathsRes = getNewJsonEntryPaths(moduleFilePath, entryKey);
  if (result.isErr(pathsRes)) {
    return result.err(formatPatchSourceError(pathsRes.error));
  }
  const { jsonPath, importPath } = pathsRes.value;
  const sourceFile = ts.createSourceFile(
    valTsPath,
    valTsText,
    ts.ScriptTarget.ES2020,
  );

  // Remove the inline property, then add the `c.json(...)` reference back. The
  // entry moves to the end of the record: entry ORDER in a jsonValues record is
  // not meaningful (the Studio and the runtime key entries by name), and
  // insert-in-place would mean reimplementing insertValJsonEntry.
  const removed = removeValJsonEntry(sourceFile, [], entryKey);
  if (result.isErr(removed)) {
    return result.err(
      `${valTsPath}\n${formatOpsError(removed.error, sourceFile)}`,
    );
  }
  const inserted = insertValJsonEntry(removed.value, [], entryKey, importPath);
  if (result.isErr(inserted)) {
    return result.err(
      `${valTsPath}\n${formatOpsError(inserted.error, removed.value)}`,
    );
  }
  return result.ok({
    jsonPath,
    jsonContent: JSON.stringify(content, null, 2) + "\n",
    valTsPath,
    valTsContent: printSourceFile(inserted.value),
  });
}

/**
 * Moves ONE `.jsonValues()` entry that was written inline in the `.val.ts` into
 * its own `*.val.json`, replacing the inline value with
 * `c.json(() => import("./<key>.val.json"))`.
 *
 * The `val validate --fix` half of {@link planJsonValuesEntryExtraction}. It is
 * not expressible as a patch (a patch edits one `.val.ts` and cannot create the
 * backing JSON file), so it writes both files directly — JSON first, so a
 * failure part-way through never leaves the module pointing at a file that does
 * not exist.
 */
export function extractJsonValuesEntry(
  moduleFilePath: ModuleFilePath,
  rootDir: string,
  entryKey: string,
  content: Json,
  sourceFileHandler: ValSourceFileHandler,
): void {
  const valTsPath = sourceFileHandler.resolveSourceModulePath(
    getSyntheticContainingPath(rootDir),
    `.${moduleFilePath
      .replace(".val.ts", ".val")
      .replace(".val.js", ".val")
      .replace(".val.jsx", ".val")
      .replace(".val.tsx", ".val")}`,
  );
  const valTsText = sourceFileHandler.host.readFile(valTsPath);
  if (valTsText === undefined) {
    throw Error(`Source file ${valTsPath} not found`);
  }
  const planned = planJsonValuesEntryExtraction({
    moduleFilePath,
    entryKey,
    content,
    valTsPath,
    valTsText,
  });
  if (result.isErr(planned)) {
    throw Error(planned.error);
  }
  const absoluteJsonPath = path.join(rootDir, planned.value.jsonPath);
  if (sourceFileHandler.host.fileExists(absoluteJsonPath)) {
    throw Error(
      `Cannot extract .jsonValues() entry '${entryKey}' of ${moduleFilePath}: '${planned.value.jsonPath}' already exists`,
    );
  }

  sourceFileHandler.writeFile(
    absoluteJsonPath,
    planned.value.jsonContent,
    "utf8",
  );
  sourceFileHandler.writeFile(valTsPath, planned.value.valTsContent, "utf8");
}

/**
 * The text of a source file the TS ops produced, exactly as
 * `ValSourceFileHandler.writeSourceFile` would have written it.
 *
 * The unescape undoes the printer's `\uXXXX` output for non-ASCII. Today the
 * ops splice printed text into `document.text` and this fix only ever prints an
 * ASCII `c.json(() => import("./..."))`, so nothing here is escaped and the
 * unescape is a no-op — but `neverAsciiEscape` is off in the printer, so that is
 * a property of what this fix happens to print, not a guarantee. Kept because
 * this replaced a `writeSourceFile` call and the text written must not change.
 *
 * https://github.com/microsoft/TypeScript/issues/36174
 */
function printSourceFile(sourceFile: ts.SourceFile): string {
  return unescape(sourceFile.text.replace(/\\u/g, "%u"));
}

function formatOpsError(
  error: PatchError | ValSyntaxErrorTree,
  sourceFile: ts.SourceFile,
): string {
  if (error instanceof PatchError) {
    return error.message;
  }
  return flatMapErrors(error, (e) => formatSyntaxError(e, sourceFile)).join(
    "\n",
  );
}
