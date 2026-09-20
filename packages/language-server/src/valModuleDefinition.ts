import ts from "typescript";
import { findDefaultExport } from "@valbuild/server";
import type { Range } from "vscode-languageserver";

/**
 * Where a file declares its Val module, or `undefined` when it declares none.
 *
 * `*.val.ts` is a naming convention, not a guarantee: a file under it may hold
 * nothing but the schemas and helpers the modules beside it import. The default
 * export is what separates the two, and `findDefaultExport` in
 * `@valbuild/server` is the one implementation of that rule — the same one
 * `val validate` uses to decide whether an unregistered file is worth reporting
 * at all. It is imported rather than reimplemented because the subtleties are
 * not obvious (a star re-export carries no default, a type-only export is gone
 * after transpilation), and two copies would answer differently the first time
 * one of them was fixed.
 *
 * Only the `export default` keywords are returned, never the whole definition:
 * a module's source is most of its file, and a diagnostic spanning that paints
 * the file red.
 */
export function findValModuleDefinition(
  sourceFile: ts.SourceFile,
): Range | undefined {
  const statement = findDefaultExport(sourceFile);
  if (!statement) {
    return undefined;
  }
  const start = statement.getStart(sourceFile);
  return {
    start: sourceFile.getLineAndCharacterOfPosition(start),
    end: sourceFile.getLineAndCharacterOfPosition(
      keywordsEnd(sourceFile, statement, start),
    ),
  };
}

/**
 * The end of the `export default` a statement opens with.
 *
 * Three shapes reach this, and only the first two can be narrowed: `export
 * default <expr>`, where everything before the expression is the keywords;
 * `export default function f() {}` and `export default class C {}`, where they
 * are modifiers; and `export { x as default }`, which has no `default` keyword
 * to stop at and is short enough to underline whole.
 */
function keywordsEnd(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  start: number,
): number {
  if (ts.isExportAssignment(statement)) {
    // Up to the exported expression is `export default` plus whitespace (and,
    // rarely, a comment); trimming the tail keeps the underline on the keywords.
    return (
      start +
      sourceFile.text
        .slice(start, statement.expression.getStart(sourceFile))
        .trimEnd().length
    );
  }
  const defaultModifier = ts.canHaveModifiers(statement)
    ? (ts.getModifiers(statement) ?? []).find(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      )
    : undefined;
  return defaultModifier?.end ?? statement.end;
}

/** Parse a Val module's text the way {@link findValModuleDefinition} needs it. */
export function parseValModule(
  moduleFilePath: string,
  text: string,
): ts.SourceFile {
  // Parent pointers: `getStart` walks them to skip leading trivia.
  return ts.createSourceFile(
    moduleFilePath,
    text,
    ts.ScriptTarget.ES2020,
    true,
  );
}
