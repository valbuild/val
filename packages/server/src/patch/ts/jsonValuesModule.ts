import ts from "typescript";

export type JsonValuesEntry = {
  /** The string literal inside `import("...")` in the entry's thunk. */
  importPath: string;
};

/**
 * Given the `source` object-literal expression of a `.jsonValues()` record /
 * router (the 3rd argument to `c.define`, via {@link analyzeValModule}),
 * extracts each entry's `c.json(() => import("..."))` import path, keyed by
 * entry key. Entries whose value is not a `c.json(...)` call are skipped.
 */
export function analyzeJsonValuesEntries(
  source: ts.Expression,
): Map<string, JsonValuesEntry> {
  const entries = new Map<string, JsonValuesEntry>();
  if (!ts.isObjectLiteralExpression(source)) {
    return entries;
  }
  for (const prop of source.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    const key = getPropertyKey(prop.name);
    if (key === null) {
      continue;
    }
    const entry = analyzeCJsonCall(prop.initializer);
    if (entry) {
      entries.set(key, entry);
    }
  }
  return entries;
}

/**
 * The `import("...")` STRING-LITERAL NODE of one entry, rather than its text.
 *
 * `analyzeJsonValuesEntries` deliberately hands out plain strings — every reader
 * of it only wants the path. Rewriting an entry's path needs the node itself, so
 * the edit can replace the specifier IN PLACE: the alternative (remove + insert
 * the whole property, as `extractJsonValuesEntry` does) moves the entry to the
 * end of the record, which is harmless for one added entry but reorders a
 * hand-maintained record of hundreds for no reason.
 */
export function findJsonValuesEntryImportPathNode(
  source: ts.Expression,
  entryKey: string,
): ts.StringLiteralLike | undefined {
  if (!ts.isObjectLiteralExpression(source)) {
    return undefined;
  }
  for (const prop of source.properties) {
    if (!ts.isPropertyAssignment(prop)) {
      continue;
    }
    if (getPropertyKey(prop.name) !== entryKey) {
      continue;
    }
    if (
      !ts.isCallExpression(prop.initializer) ||
      !isCJson(prop.initializer.expression)
    ) {
      return undefined;
    }
    const [thunk] = prop.initializer.arguments;
    if (!thunk) {
      return undefined;
    }
    return getImportPathNodeFromThunk(thunk) ?? undefined;
  }
  return undefined;
}

function getPropertyKey(name: ts.PropertyName): string | null {
  if (ts.isStringLiteralLike(name)) {
    return name.text;
  }
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  return null;
}

function analyzeCJsonCall(node: ts.Expression): JsonValuesEntry | null {
  // c.json(() => import("path"))
  if (!ts.isCallExpression(node) || !isCJson(node.expression)) {
    return null;
  }
  const [thunk] = node.arguments;
  if (!thunk) {
    return null;
  }
  const importPathNode = getImportPathNodeFromThunk(thunk);
  if (importPathNode === null) {
    return null;
  }
  return { importPath: importPathNode.text };
}

function isCJson(expr: ts.Expression): boolean {
  // c.json
  return (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "c" &&
    ts.isIdentifier(expr.name) &&
    expr.name.text === "json"
  );
}

function getImportPathNodeFromThunk(
  thunk: ts.Expression,
): ts.StringLiteralLike | null {
  // () => import("path")   (concise body)   OR   () => { return import("path"); }
  if (!ts.isArrowFunction(thunk)) {
    return null;
  }
  let importCall: ts.Expression | undefined;
  if (ts.isCallExpression(thunk.body)) {
    importCall = thunk.body;
  } else if (ts.isBlock(thunk.body)) {
    for (const stmt of thunk.body.statements) {
      if (
        ts.isReturnStatement(stmt) &&
        stmt.expression &&
        ts.isCallExpression(stmt.expression)
      ) {
        importCall = stmt.expression;
        break;
      }
    }
  }
  if (!importCall || !ts.isCallExpression(importCall)) {
    return null;
  }
  const isImport =
    importCall.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(importCall.expression) &&
      importCall.expression.text === "import");
  if (!isImport) {
    return null;
  }
  const arg = importCall.arguments[0];
  if (arg && ts.isStringLiteralLike(arg)) {
    return arg;
  }
  return null;
}
