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
  /**
   * True when the string is an object key rather than a value.
   *
   * The distinction decides which schema to consult: a value is described by the
   * schema at its own path, whereas a key is described by its *container* — a
   * gallery record, for instance, is keyed by file reference.
   */
  isPropertyName: boolean;
  /**
   * Name of the property this string is the value of, when it is one.
   *
   * Used for structures Val treats as opaque: a richtext link node is a plain
   * object with `href`, so there is no schema at that path to consult.
   */
  valueOfProperty?: string;
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
  /**
   * Start offset of the reference argument, including its opening quote.
   *
   * Stable while the user types to filter the completion list, because every
   * such keystroke lands *inside* the literal. That makes it the anchor
   * {@link findFileRefArgument} re-locates the call by at resolve time.
   */
  refArgStart: number;
  /** End offset of the reference argument, where a metadata argument follows. */
  refArgEnd: number;
  /** Offsets of an existing metadata argument, when there is one. */
  metadataStart?: number;
  metadataEnd?: number;
};

/**
 * The offsets of a string literal's contents, excluding its quotes.
 *
 * A client that does not auto-close quotes leaves `c.image("` unterminated while
 * the user types. TypeScript still produces a string-literal node for it, but the
 * node ends *at* the cursor rather than one character past it, so the usual
 * `getEnd() - 1` bound excludes every position inside the literal and no
 * completions are offered at all. The closing quote is therefore counted rather
 * than assumed.
 */
function contentRangeOf(
  node: ts.StringLiteralLike,
  sourceFile: ts.SourceFile,
): { contentStart: number; contentEnd: number } {
  const raw = node.getText(sourceFile);
  const quote = raw[0];
  let closing = 0;
  if (raw.length >= 2 && raw[raw.length - 1] === quote) {
    // A quote preceded by an odd number of backslashes is escaped, so it is part
    // of the contents rather than the terminator.
    let backslashes = 0;
    for (let i = raw.length - 2; i >= 1 && raw[i] === "\\"; i--) {
      backslashes++;
    }
    closing = backslashes % 2 === 0 ? 1 : 0;
  }
  return {
    contentStart: node.getStart(sourceFile) + 1,
    contentEnd: node.getEnd() - closing,
  };
}

/**
 * Find the innermost `c.image(...)` / `c.file(...)` call whose first argument
 * contains `offset`.
 */
export function getValCompletionContext(
  sourceFile: ts.SourceFile,
  offset: number,
): ValCompletionContext | undefined {
  let found: ValFileRefContext | undefined;
  let innermostString: ts.StringLiteralLike | undefined;
  let innermostStringContent:
    | { contentStart: number; contentEnd: number }
    | undefined;
  // Tracked explicitly: `ts.createSourceFile` does not set parent pointers
  // unless asked, so `node.parent` cannot be relied on here.
  let innermostStringParent: ts.Node | undefined;

  function visit(node: ts.Node, parent: ts.Node | undefined): void {
    if (offset < node.getStart(sourceFile) || offset > node.getEnd()) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const subType = fileConstructorSubType(node, sourceFile);
      const [refArg] = node.arguments;
      const refContent =
        refArg && ts.isStringLiteralLike(refArg)
          ? contentRangeOf(refArg, sourceFile)
          : undefined;
      if (
        subType &&
        refArg &&
        ts.isStringLiteralLike(refArg) &&
        refContent &&
        // Inside the quotes, inclusive of both ends so completion works on an
        // empty string and at either edge.
        offset >= refContent.contentStart &&
        offset <= refContent.contentEnd
      ) {
        const metadataArg = node.arguments[1];
        found = {
          kind: "file-ref",
          subType,
          currentText: refArg.text,
          ...refContent,
          refArgStart: refArg.getStart(sourceFile),
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
    if (ts.isStringLiteralLike(node)) {
      const content = contentRangeOf(node, sourceFile);
      if (offset >= content.contentStart && offset <= content.contentEnd) {
        innermostString = node;
        innermostStringContent = content;
        innermostStringParent = parent;
      }
    }
    ts.forEachChild(node, (child) => visit(child, node));
  }
  visit(sourceFile, undefined);

  if (found) {
    return found;
  }
  // Not a file reference, but still inside a string: schema-driven completions
  // (keyOf keys, route paths) decide whether they apply.
  if (innermostString && innermostStringContent) {
    return {
      kind: "string-value",
      currentText: innermostString.text,
      ...innermostStringContent,
      // Uses the parent tracked during the walk, not `node.parent`, which
      // `ts.createSourceFile` leaves unset unless asked to populate it.
      isPropertyName: Boolean(
        innermostStringParent &&
        ts.isPropertyAssignment(innermostStringParent) &&
        innermostStringParent.name === innermostString,
      ),
      ...(innermostStringParent &&
      ts.isPropertyAssignment(innermostStringParent) &&
      innermostStringParent.name !== innermostString &&
      (ts.isIdentifier(innermostStringParent.name) ||
        ts.isStringLiteral(innermostStringParent.name))
        ? { valueOfProperty: innermostStringParent.name.text }
        : {}),
    };
  }
  return undefined;
}

/**
 * Re-find the `c.image(...)` / `c.file(...)` call whose reference argument starts
 * at `refArgStart`, and report where its arguments are *now*.
 *
 * `completionItem/resolve` runs against a document the user may have typed into
 * since the list was computed, so the offsets captured back then have moved.
 * Applying them anyway inserts the metadata object into the middle of the string
 * literal and corrupts the file, so the offsets are re-derived here instead.
 *
 * Returns `undefined` when no such call is found — the document changed in some
 * way this anchor does not survive, and the caller must then offer no edit
 * rather than a wrong one.
 */
export function findFileRefArgument(
  sourceFile: ts.SourceFile,
  refArgStart: number,
):
  | {
      refArgEnd: number;
      metadataStart?: number;
      metadataEnd?: number;
    }
  | undefined {
  let found:
    | { refArgEnd: number; metadataStart?: number; metadataEnd?: number }
    | undefined;

  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (ts.isCallExpression(node) && fileConstructorSubType(node, sourceFile)) {
      const [refArg] = node.arguments;
      if (
        refArg &&
        ts.isStringLiteralLike(refArg) &&
        refArg.getStart(sourceFile) === refArgStart
      ) {
        const metadataArg = node.arguments[1];
        found = {
          refArgEnd: refArg.getEnd(),
          ...(metadataArg
            ? {
                metadataStart: metadataArg.getStart(sourceFile),
                metadataEnd: metadataArg.getEnd(),
              }
            : {}),
        };
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
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
