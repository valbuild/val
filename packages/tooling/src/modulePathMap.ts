import * as ts from "typescript";

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
) {
  const segments = modulePath.split(".").map((segment) => JSON.parse(segment)); // TODO: this is not entirely correct, but works for now. We have a function I think that does this so replace this with it
  let range = modulePathMap[segments[0]];
  for (const pathSegment of segments.slice(1)) {
    if (!range) {
      break;
    }
    range = range?.children?.[pathSegment];
  }
  return (
    range?.start &&
    range?.end && {
      start: range.start,
      end: range.end,
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
      node.expression.name.getText(sourceFile) === "file"
    ) {
      const val = {
        children: {},
        start: sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ), // TODO: We do + 1 to line up the diagnostics error exactly below a normal
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
