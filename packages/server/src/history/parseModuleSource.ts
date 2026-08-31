import ts from "typescript";
import { result } from "@valbuild/core/fp";
import type { ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { analyzeValModule } from "../patch/ts/valModule";
import { evaluateExpression, formatSyntaxErrorTree } from "../patch/ts/syntax";
import type { HistoryError } from "./HistoryError";

/**
 * The JSON source of a `.val.ts`, from its text alone.
 *
 * STATIC: it parses the file and evaluates the literal that `c.define` was
 * given. It does not run the module, which matters twice over - reconstructing
 * an old commit must not execute code from it, and evaluating a historical
 * module would need the imports it had then, which no longer exist.
 *
 * The narrowness is the same narrowness Val's own patching relies on: `TSOps`
 * edits a `.val.ts` by rewriting literals, so a module whose source is not
 * literal was never patchable. A file that fails here is genuinely one history
 * cannot reconstruct - typically authored before the current shape (a
 * `c.image(...)` call where a plain object now goes) - and saying so is the
 * correct answer.
 */
export function parseModuleSource(
  moduleFilePath: ModuleFilePath,
  text: string,
): result.Result<JSONValue, HistoryError> {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      "<val>",
      text,
      ts.ScriptTarget.ES2015,
      // No parent pointers: nothing here walks upwards, and building them costs
      // memory on every module of every commit being compared.
      false,
    );
  } catch (err) {
    return result.err({
      kind: "source-unparseable",
      moduleFilePath,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  let analysis;
  try {
    analysis = analyzeValModule(sourceFile);
  } catch (err) {
    // analyzeValModule THROWS when there is no default export to look at,
    // rather than returning an error - so a file that is not a val module at
    // all arrives here.
    return result.err({
      kind: "source-unparseable",
      moduleFilePath,
      message:
        err instanceof Error
          ? err.message
          : "not a val module (no c.define default export?)",
    });
  }
  if (result.isErr(analysis)) {
    return result.err({
      kind: "source-unparseable",
      moduleFilePath,
      message: formatSyntaxErrorTree(analysis.error, sourceFile).join("; "),
    });
  }

  const source = evaluateExpression(analysis.value.source);
  if (result.isErr(source)) {
    return result.err({
      kind: "source-unparseable",
      moduleFilePath,
      message: formatSyntaxErrorTree(source.error, sourceFile).join("; "),
    });
  }
  return result.ok(source.value);
}
