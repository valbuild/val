import ts from "typescript";
import { Internal, type ModulePath } from "@valbuild/core";

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
    const tsEnd = sourceFile.getLineAndCharacterOfPosition(node.end);
    const start = {
      line: tsEnd.line,
      character: tsEnd.character - node.getWidth(sourceFile),
    };
    const end = {
      line: tsEnd.line,
      character: tsEnd.character,
    };
    return {
      "": {
        children: {},
        start,
        end,
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
        start: sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ),
        end: sourceFile.getLineAndCharacterOfPosition(node.getEnd()),
      };
      if (node.arguments[0]) {
        const firstArgEnd = sourceFile.getLineAndCharacterOfPosition(
          node.arguments[0].end,
        );
        const _ref = {
          children: {},
          start: {
            line: firstArgEnd.line,
            character:
              firstArgEnd.character - node.arguments[0].getWidth(sourceFile),
          },
          end: {
            line: firstArgEnd.line,
            character: firstArgEnd.character,
          },
        };
        if (!node.arguments[1]) {
          return {
            val,
            _ref,
          };
        }
        const metadataEnd = sourceFile.getLineAndCharacterOfPosition(
          node.arguments[1].end,
        );
        return {
          val,
          _ref,
          metadata: {
            children: {},
            start: {
              line: metadataEnd.line,
              character:
                metadataEnd.character - node.arguments[1].getWidth(sourceFile),
            },
            end: {
              line: metadataEnd.line,
              character: metadataEnd.character,
            },
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
      const tsEnd = sourceFile.getLineAndCharacterOfPosition(element.end);
      const start = {
        line: tsEnd.line,
        character: tsEnd.character - element.getWidth(sourceFile),
      };
      const end = {
        line: tsEnd.line,
        character: tsEnd.character,
      };
      return {
        ...acc,
        [index]: {
          children: traverse(element, sourceFile),
          start,
          end,
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
        const tsEnd = sourceFile.getLineAndCharacterOfPosition(
          property.name.getEnd(),
        );
        const start = {
          line: tsEnd.line,
          character: tsEnd.character - property.name.getWidth(sourceFile),
        };
        const end = {
          line: tsEnd.line,
          character: tsEnd.character,
        };
        const val = {
          children: {},
          start: sourceFile.getLineAndCharacterOfPosition(
            property.initializer.getStart(sourceFile),
          ),
          end: sourceFile.getLineAndCharacterOfPosition(
            property.initializer.getEnd(),
          ),
        };
        return {
          ...acc,
          [key]: {
            children: {
              val,
              ...traverse(value, sourceFile),
            },
            start,
            end,
          },
        };
      }
    }
    return acc;
  }, {});
}
