import ts from "typescript";

/**
 * Works out what the cursor is sitting in, so completions can be offered for it.
 *
 * AST-based rather than text/regex-based: `c.image(` can be nested, wrapped or
 * multi-line, and matching on text gets that wrong in exactly the cases where a
 * user most wants help.
 */

export type ValCompletionContext = ValFileRefContext | ValStringValueContext;

/** The cursor is inside a plain string in the module's content. */
export type ValStringValueContext = {
  kind: "string-value";
  currentText: string;
  contentStart: number;
  contentEnd: number;
};

export type ValFileRefContext = {
  kind: "file-ref";
  /** Which constructor: `c.image(...)` or `c.file(...)`. */
  subType: "image" | "file";
  /** The string literal being edited, without quotes. */
  currentText: string;
  /** Offsets of the string literal's contents, excluding the quotes. */
  contentStart: number;
  contentEnd: number;
  /** End offset of the reference argument, where a metadata argument follows. */
  refArgEnd: number;
  /** Offsets of an existing metadata argument, when there is one. */
  metadataStart?: number;
  metadataEnd?: number;
};

/**
 * Find the innermost `c.image(...)` / `c.file(...)` call whose first argument
 * contains `offset`.
 */
export function getValCompletionContext(
  sourceFile: ts.SourceFile,
  offset: number,
): ValCompletionContext | undefined {
  let found: ValCompletionContext | undefined;
  let innermostString: ts.StringLiteralLike | undefined;

  function visit(node: ts.Node): void {
    if (offset < node.getStart(sourceFile) || offset > node.getEnd()) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const subType = fileConstructorSubType(node, sourceFile);
      const [refArg] = node.arguments;
      if (
        subType &&
        refArg &&
        ts.isStringLiteralLike(refArg) &&
        // Inside the quotes, inclusive of both ends so completion works on an
        // empty string and at either edge.
        offset >= refArg.getStart(sourceFile) + 1 &&
        offset <= refArg.getEnd() - 1
      ) {
        const metadataArg = node.arguments[1];
        found = {
          kind: "file-ref",
          subType,
          currentText: refArg.text,
          contentStart: refArg.getStart(sourceFile) + 1,
          contentEnd: refArg.getEnd() - 1,
          refArgEnd: refArg.getEnd(),
          ...(metadataArg
            ? {
                metadataStart: metadataArg.getStart(sourceFile),
                metadataEnd: metadataArg.getEnd(),
              }
            : {}),
        };
      }
    }
    if (
      ts.isStringLiteralLike(node) &&
      offset >= node.getStart(sourceFile) + 1 &&
      offset <= node.getEnd() - 1
    ) {
      innermostString = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (found) {
    return found;
  }
  // Not a file reference, but still inside a string: schema-driven completions
  // (keyOf keys, route paths) decide whether they apply.
  if (innermostString) {
    return {
      kind: "string-value",
      currentText: innermostString.text,
      contentStart: innermostString.getStart(sourceFile) + 1,
      contentEnd: innermostString.getEnd() - 1,
    };
  }
  return undefined;
}

function fileConstructorSubType(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): "image" | "file" | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  if (node.expression.expression.getText(sourceFile) !== "c") {
    return undefined;
  }
  const name = node.expression.name.getText(sourceFile);
  return name === "image" || name === "file" ? name : undefined;
}
