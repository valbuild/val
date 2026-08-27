import ts from "typescript";
import { Internal, type ModulePath } from "@valbuild/core";

/**
 * NOTE: `@valbuild/language-server` has a near-identical `modulePathMap.ts`.
 * Fix traversal bugs in both, or fold them together.
 */

export type ModulePathMap = {
  [modulePath: string]: {
    children: ModulePathMap;
    start: {
      line: number;
      character: number;
    };
    end: {
      line: number;
      character: number;
    };
  };
};

export function getModulePathRange(
  modulePath: string,
  modulePathMap: ModulePathMap,
  // Which part of an object/record member to point at. For an object property
  // the resolved node's own range is the *key* (property name); the *value*
  // range is stored under `children.val`. Array elements, leaf literals and
  // Array elements and leaf literals have no `val` child, so "value" falls back
  // to the node's own range for those. Defaults to "key" to preserve existing
  // callers.
  target: "key" | "value" = "key",
) {
  // Handle invalid module paths gracefully
  if (typeof modulePath !== "string") {
    return undefined;
  }

  let range: ModulePathMap[string] | undefined;
  if (modulePath === "") {
    // The empty module path is the module root, stored under the "" key: the
    // source argument of `c.define`. This is what module-level diagnostics
    // (which have no module path) resolve to.
    range = modulePathMap[""];
  } else {
    let segments: string[];
    try {
      // Quote-aware splitter that correctly handles keys containing dots
      // (e.g. file refs like `"/public/val/images/logo.png"`), unlike a naive
      // split on ".". Throws on malformed input (e.g. unbalanced quotes).
      segments = Internal.splitModulePath(modulePath as ModulePath);
    } catch {
      // Return undefined if the module path is malformed. This can happen when
      // there are upstream errors in schema serialization.
      return undefined;
    }

    if (segments.length === 0) {
      return undefined;
    }

    range = modulePathMap[segments[0]];
    for (const pathSegment of segments.slice(1)) {
      if (!range) {
        break;
      }
      range = range?.children?.[pathSegment];
    }
  }

  if (!range) {
    return undefined;
  }

  const valueRange = target === "value" ? range.children?.val : undefined;
  const resolved = valueRange ?? range;
  return (
    resolved.start &&
    resolved.end && {
      start: resolved.start,
      end: resolved.end,
    }
  );
}

/**
 * The line/character range of `node`'s own text (leading trivia excluded).
 *
 * NOTE: do not compute the start as `end.character - node.getWidth()`. That
 * identity only holds while the node stays on a single line - for a multi-line
 * node (an object inside an array, a media object's `path`, ...) it
 * reports the *closing* line and a negative character.
 */
function rangeOf(node: ts.Node, sourceFile: ts.SourceFile) {
  return {
    start: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)),
    end: sourceFile.getLineAndCharacterOfPosition(node.getEnd()),
  };
}

export function createModulePathMap(
  sourceFile: ts.SourceFile,
): ModulePathMap | undefined {
  for (const child of sourceFile
    .getChildren()
    .flatMap((child) => child.getChildren())) {
    if (ts.isExportAssignment(child)) {
      const contentNode =
        child.expression &&
        ts.isCallExpression(child.expression) &&
        child.expression.arguments[2];

      if (contentNode) {
        const map = traverse(contentNode, sourceFile) ?? {};
        // Always expose the module root under the "" key so diagnostics without
        // a module path still resolve to a location. `traverse` already emits ""
        // for primitive roots (with a tighter range), so keep that if present.
        // Object/record keys are never "" (see traverseObjectLiteral), so this
        // cannot collide with a real key.
        return {
          ...map,
          "": map[""] ?? {
            children: {},
            start: sourceFile.getLineAndCharacterOfPosition(
              contentNode.getStart(sourceFile),
            ),
            end: sourceFile.getLineAndCharacterOfPosition(contentNode.getEnd()),
          },
        };
      }
    }
  }
}

/**
 * The {@link createModulePathMap} equivalent for a `.jsonValues()` entry's
 * backing `*.val.json`.
 *
 * The file IS the entry's value, so the map is rooted at the JSON document
 * rather than at a `c.define` argument — but everything below is the same shape,
 * which means a module path like `"title"` (the part after the entry key)
 * resolves against it exactly as it would inside a `.val.ts`.
 */
export function createJsonEntryPathMap(
  jsonSourceFile: ts.JsonSourceFile,
): ModulePathMap | undefined {
  const statement = jsonSourceFile.statements[0];
  if (!statement) {
    return undefined;
  }
  return traverse(statement.expression, jsonSourceFile);
}

function traverse(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
): ModulePathMap | undefined {
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return {
      "": {
        children: {},
        ...rangeOf(node, sourceFile),
      },
    };
  }
  if (ts.isObjectLiteralExpression(node)) {
    return traverseObjectLiteral(node, sourceFile);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return traverseArrayLiteral(node, sourceFile);
  }
}

function traverseArrayLiteral(
  node: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
): ModulePathMap {
  return node.elements.reduce((acc, element, index) => {
    if (ts.isExpression(element)) {
      return {
        ...acc,
        [index]: {
          children: traverse(element, sourceFile),
          ...rangeOf(element, sourceFile),
        },
      };
    }
    return acc;
  }, {});
}

function traverseObjectLiteral(
  node: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): ModulePathMap {
  return node.properties.reduce((acc, property) => {
    if (ts.isPropertyAssignment(property)) {
      const key =
        property.name &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
        property.name.text;
      const value = property.initializer;
      if (key) {
        const val = {
          children: {},
          ...rangeOf(property.initializer, sourceFile),
        };
        return {
          ...acc,
          [key]: {
            children: {
              val,
              ...traverse(value, sourceFile),
            },
            ...rangeOf(property.name, sourceFile),
          },
        };
      }
    }
    return acc;
  }, {});
}
