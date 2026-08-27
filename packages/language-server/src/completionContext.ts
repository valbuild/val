import ts from "typescript";

/**
 * Works out what the cursor is sitting in, so completions can be offered for it.
 *
 * AST-based rather than text/regex-based: an object literal can be nested,
 * wrapped or multi-line, and matching on text gets that wrong in exactly the
 * cases where a user most wants help.
 */

export type ValCompletionContext = ValStringValueContext;

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

/**
 * The offsets of a string literal's contents, excluding its quotes.
 *
 * A client that does not auto-close quotes leaves `path: "` unterminated while
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
 * The innermost string literal containing `offset`, described well enough for a
 * schema-driven completion to decide whether it applies.
 */
export function getValCompletionContext(
  sourceFile: ts.SourceFile,
  offset: number,
): ValCompletionContext | undefined {
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

  if (!innermostString || !innermostStringContent) {
    return undefined;
  }
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

/** The properties Val computes from a file's bytes. */
export const MEDIA_METADATA_KEYS = ["width", "height", "mimeType"] as const;
export type MediaMetadataKey = (typeof MEDIA_METADATA_KEYS)[number];

export type MediaPathObject = {
  /** Offset to insert missing metadata properties after. */
  insertAfter: number;
  /** Where each metadata property's value is now, when it is there. */
  existing: Partial<Record<MediaMetadataKey, { start: number; end: number }>>;
};

/**
 * Re-find the media object literal whose `path` value starts at
 * `pathValueStart`, and report where its metadata siblings are *now*.
 *
 * `completionItem/resolve` runs against a document the user may have typed into
 * since the list was computed, so the offsets captured back then have moved.
 * Applying them anyway inserts text into the middle of the string literal and
 * corrupts the file, so the offsets are re-derived here instead.
 *
 * Returns `undefined` when no such object is found — the document changed in
 * some way this anchor does not survive, and the caller must then offer no edit
 * rather than a wrong one.
 */
export function findMediaPathObject(
  sourceFile: ts.SourceFile,
  pathValueStart: number,
): MediaPathObject | undefined {
  let found: MediaPathObject | undefined;

  function visit(node: ts.Node): void {
    if (found) {
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      const pathAssignment = node.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          nameOf(property) === "path" &&
          property.initializer.getStart(sourceFile) === pathValueStart,
      );
      if (pathAssignment) {
        const existing: MediaPathObject["existing"] = {};
        for (const property of node.properties) {
          if (!ts.isPropertyAssignment(property)) {
            continue;
          }
          const name = nameOf(property);
          if (
            name &&
            (MEDIA_METADATA_KEYS as readonly string[]).includes(name)
          ) {
            existing[name as MediaMetadataKey] = {
              start: property.initializer.getStart(sourceFile),
              end: property.initializer.getEnd(),
            };
          }
        }
        found = { insertAfter: pathAssignment.getEnd(), existing };
        return;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}

function nameOf(property: ts.PropertyAssignment): string | undefined {
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return undefined;
}
