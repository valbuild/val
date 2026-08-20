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
  // `c.image`/`c.file` `_ref`/`metadata` nodes have no `val` child, so "value"
  // falls back to the node's own range for those. Defaults to "key" to preserve
  // existing callers.
  target: "key" | "value" = "key",
) {
  // Handle empty or invalid module paths gracefully
  if (!modulePath || typeof modulePath !== "string") {
    return undefined;
  }

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

  let range = modulePathMap[segments[0]];
  for (const pathSegment of segments.slice(1)) {
    if (!range) {
      break;
    }
    range = range?.children?.[pathSegment];
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
 * node (an object inside an array, a `c.image` metadata argument, ...) it
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
        return traverse(contentNode, sourceFile);
      }
    }
  }
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
  if (ts.isCallExpression(node)) {
    return traverseCallExpression(node, sourceFile);
  }
}

function traverseCallExpression(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): ModulePathMap | undefined {
  if (ts.isPropertyAccessExpression(node.expression)) {
    if (
      node.expression.expression.getText(sourceFile) === "c" &&
      (node.expression.name.getText(sourceFile) === "file" ||
        node.expression.name.getText(sourceFile) === "image")
    ) {
      const val = {
        children: {},
        ...rangeOf(node, sourceFile),
      };
      if (node.arguments[0]) {
        const _ref = {
          children: {},
          ...rangeOf(node.arguments[0], sourceFile),
        };
        if (!node.arguments[1]) {
          return {
            val,
            _ref,
          };
        }
        return {
          val,
          _ref,
          metadata: {
            children: {},
            ...rangeOf(node.arguments[1], sourceFile),
          },
        };
      }
    }
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
