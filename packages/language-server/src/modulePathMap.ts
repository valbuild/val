import ts from "typescript";
import { Internal, type ModulePath } from "@valbuild/core";
import { result } from "@valbuild/core/fp";
import { analyzeValModule } from "@valbuild/server";

/**
 * Maps Val module paths onto positions in the module's TypeScript source.
 *
 * Validation errors come back keyed by `SourcePath` (for example
 * `/content/page.val.ts?p="hero"."image"`), but an editor needs a line/column
 * range. This walks the source expression passed to `c.define(...)` and records
 * where each addressable path lands in the file.
 *
 * This is version-sensitive by nature: it encodes how Val's module paths
 * correspond to source syntax, which is why it lives with Val rather than in an
 * editor extension.
 *
 * NOTE: `@valbuild/server` has a near-identical `modulePathMap.ts`, used for the
 * CLI's code frames and the Val UI. This copy differs in locating the source
 * expression via `analyzeValModule` and in exposing
 * {@link findModulePathAtPosition}. Fix traversal bugs in both, or fold them
 * together.
 */

export type ModulePosition = {
  line: number;
  character: number;
};

export type ModulePathRange = {
  start: ModulePosition;
  end: ModulePosition;
};

export type ModulePathMap = {
  [modulePath: string]: ModulePathRange & {
    children: ModulePathMap;
  };
};

/**
 * Look up the source range for a module path.
 *
 * Returns `undefined` when the path cannot be resolved — an unparseable path, or
 * one that does not correspond to any node. That happens legitimately when
 * schema serialization failed upstream, so callers should treat a missing range
 * as "report this diagnostic on the module instead" rather than as a bug.
 */
export function getModulePathRange(
  modulePath: string,
  modulePathMap: ModulePathMap,
): ModulePathRange | undefined {
  if (!modulePath || typeof modulePath !== "string") {
    return undefined;
  }

  let segments: string[];
  try {
    // Val's own splitter: handles quoted segments and escaped quotes, which a
    // naive modulePath.split(".").map(JSON.parse) does not.
    segments = Internal.splitModulePath(modulePath as ModulePath);
  } catch {
    return undefined;
  }
  if (segments.length === 0) {
    return undefined;
  }

  let entry = modulePathMap[segments[0]];
  for (const segment of segments.slice(1)) {
    if (!entry) {
      break;
    }
    entry = entry.children?.[segment];
  }
  if (!entry?.start || !entry?.end) {
    return undefined;
  }
  return { start: entry.start, end: entry.end };
}

/**
 * Find the module path of the innermost entry whose range contains `position`.
 *
 * The inverse of the map's normal use: given where the cursor is, work out which
 * part of the module it addresses, so the schema there can be looked up. Used by
 * schema-driven completions.
 *
 * Segments are encoded with `Internal.patchPathToModulePath`, so the result is
 * addressable by the same functions that consume validation error paths.
 */
export function findModulePathAtPosition(
  modulePathMap: ModulePathMap,
  position: ModulePosition,
): ModulePath | undefined {
  const segments: string[] = [];

  function descend(map: ModulePathMap): boolean {
    for (const [segment, entry] of Object.entries(map)) {
      // `val` is synthetic (it marks where a property's value sits) and `""`
      // marks a bare literal. Both have no children, and `val` spans the entire
      // value — so descending into either would match first and stop the walk
      // before it reached the real nested key. They are skipped as descent
      // targets, and used only for containment below.
      if (segment === "val" || segment === "") {
        continue;
      }
      // An entry's own range covers only its key, so also accept a cursor inside
      // its value; otherwise nothing nested would ever match its parents.
      const valChild = entry.children?.val;
      if (
        !contains(entry, position) &&
        !(valChild && contains(valChild, position))
      ) {
        continue;
      }
      segments.push(segment);
      descend(entry.children);
      return true;
    }
    return false;
  }
  if (!descend(modulePathMap)) {
    return undefined;
  }
  return Internal.patchPathToModulePath(segments);
}

function contains(range: ModulePathRange, position: ModulePosition): boolean {
  const afterStart =
    position.line > range.start.line ||
    (position.line === range.start.line &&
      position.character >= range.start.character);
  const beforeEnd =
    position.line < range.end.line ||
    (position.line === range.end.line &&
      position.character <= range.end.character);
  return afterStart && beforeEnd;
}

/**
 * Build a {@link ModulePathMap} for a Val module source file.
 *
 * Returns `undefined` when the file is not a recognisable Val module (no
 * `export default c.define(...)`).
 */
export function createModulePathMap(
  sourceFile: ts.SourceFile,
): ModulePathMap | undefined {
  const source = findSourceExpression(sourceFile);
  if (!source) {
    return undefined;
  }
  return traverse(source, sourceFile);
}

/**
 * Locate the third argument of `c.define(...)` — the module's content.
 *
 * Uses Val's own `analyzeValModule`, which validates that the default export
 * really is a `c.define` call with a string-literal path, rather than blindly
 * taking `arguments[2]` of whatever the default export happens to call.
 */
function findSourceExpression(
  sourceFile: ts.SourceFile,
): ts.Expression | undefined {
  let analysis;
  try {
    analysis = analyzeValModule(sourceFile);
  } catch {
    // analyzeValModule throws when there is no default export at all.
    return undefined;
  }
  if (result.isErr(analysis)) {
    return undefined;
  }
  return analysis.value.source;
}

function traverse(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
): ModulePathMap | undefined {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return { "": { children: {}, ...rangeOfNode(node, sourceFile) } };
  }
  if (ts.isObjectLiteralExpression(node)) {
    return traverseObjectLiteral(node, sourceFile);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return traverseArrayLiteral(node, sourceFile);
  }
  if (ts.isCallExpression(node)) {
    return traverseCallExpression(node, sourceFile);
  }
}

/**
 * The line/character range of `node`'s own text (leading trivia excluded).
 *
 * NOTE: do not compute the start as `end.character - node.getWidth()`. That
 * identity only holds while the node stays on a single line - for a multi-line
 * node (an object inside an array, a `c.image` metadata argument, ...) it
 * reports the *closing* line and a negative character. `getStart(sourceFile)`
 * needs no parent pointers as long as the source file is passed explicitly,
 * which is why it is safe here.
 */
function rangeOfNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): ModulePathRange {
  return {
    start: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)),
    end: sourceFile.getLineAndCharacterOfPosition(node.getEnd()),
  };
}

/**
 * `c.image(...)` / `c.file(...)` expose three addressable paths: the call itself
 * (`val`), the reference argument (`_ref`) and the metadata argument
 * (`metadata`). Validation errors about a missing file point at `_ref`, and
 * errors about metadata point at `metadata`, so both need their own range.
 */
function traverseCallExpression(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ModulePathMap | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) {
    return undefined;
  }
  const isValFileConstructor =
    node.expression.expression.getText(sourceFile) === "c" &&
    (node.expression.name.getText(sourceFile) === "file" ||
      node.expression.name.getText(sourceFile) === "image");
  if (!isValFileConstructor || !node.arguments[0]) {
    return undefined;
  }

  const val = { children: {}, ...rangeOfNode(node, sourceFile) };
  const _ref = {
    children: {},
    ...rangeOfNode(node.arguments[0], sourceFile),
  };
  if (!node.arguments[1]) {
    return { val, _ref };
  }
  return {
    val,
    _ref,
    metadata: { children: {}, ...rangeOfNode(node.arguments[1], sourceFile) },
  };
}

function traverseArrayLiteral(
  node: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
): ModulePathMap {
  const map: ModulePathMap = {};
  node.elements.forEach((element, index) => {
    if (!ts.isExpression(element)) {
      return;
    }
    map[index] = {
      children: traverse(element, sourceFile) ?? {},
      ...rangeOfNode(element, sourceFile),
    };
  });
  return map;
}

function traverseObjectLiteral(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): ModulePathMap {
  const map: ModulePathMap = {};
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }
    const key =
      property.name &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text;
    // NOTE: this also skips `""`, which is what a gallery key looks like the
    // moment the user opens the quote. That is deliberate, not an oversight: a
    // module path cannot address an empty segment, because
    // `Internal.splitModulePath('""')` returns `[]`, and `""` already means
    // "bare literal" in this map (see findModulePathAtPosition). Supporting it
    // needs a change in @valbuild/core first.
    if (!key) {
      continue;
    }
    map[key] = {
      children: {
        // `val` addresses the property's value, whereas the key's own range is
        // what a diagnostic about the field itself should highlight.
        val: { children: {}, ...rangeOfNode(property.initializer, sourceFile) },
        ...traverse(property.initializer, sourceFile),
      },
      ...rangeOfNode(property.name, sourceFile),
    };
  }
  return map;
}
