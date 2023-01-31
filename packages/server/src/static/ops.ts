import ts from "typescript";
import {
  evaluateExpression,
  find,
  findObjectPropertyAssignment,
  flattenErrors,
  StaticValue,
} from "./analysis";
import * as result from "../result";

function toExpression(value: StaticValue): ts.Expression {
  if (typeof value === "string") {
    return ts.factory.createStringLiteral(value);
  } else if (typeof value === "number") {
    return ts.factory.createNumericLiteral(value);
  } else if (typeof value === "boolean") {
    return value ? ts.factory.createTrue() : ts.factory.createFalse();
  } else if (value === null) {
    return ts.factory.createNull();
  } else if (Array.isArray(value)) {
    return ts.factory.createArrayLiteralExpression(value.map(toExpression));
  } else if (typeof value === "object") {
    return ts.factory.createObjectLiteralExpression(
      Object.entries(value).map(([key, value]) =>
        ts.factory.createPropertyAssignment(key, toExpression(value))
      )
    );
  } else {
    return ts.factory.createStringLiteral(value);
  }
}

declare module "typescript" {
  interface PrinterOptions {
    neverAsciiEscape?: boolean;
  }
}

// TODO: Choose newline based on project settings/heuristics/system default?
const newLine = ts.NewLineKind.LineFeed;
// TODO: Handle indentation of printed code
const printer = ts.createPrinter({
  newLine: newLine,
  // neverAsciiEscape: true,
});

function replaceNode(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  replacement: ts.Node
): ts.SourceFile {
  const replacementText = printer.printNode(
    ts.EmitHint.Unspecified,
    replacement,
    sourceFile
  );
  const start = node.getFullStart();
  const end = node.end;
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${replacementText}${sourceFile.text.substring(end)}`;

  return sourceFile.update(newText, {
    span: {
      start,
      length: end - start,
    },
    newLength: replacementText.length,
  });
}

function replaceNodeValue(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  value: StaticValue
): [sourceFile: ts.SourceFile, replaced: ts.Node] {
  const replacementText = printer.printNode(
    ts.EmitHint.Unspecified,
    toExpression(value),
    sourceFile
  );
  const start = node.getStart(sourceFile, false);
  const end = node.end;
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${replacementText}${sourceFile.text.substring(end)}`;

  return [
    sourceFile.update(newText, {
      span: {
        start,
        length: end - start,
      },
      newLength: replacementText.length,
    }),
    node,
  ];
}

function isIndentation(s: string): boolean {
  for (let i = 0; i < s.length; ++i) {
    const c = s.charAt(i);
    if (c !== " " && c !== "\t") {
      return false;
    }
  }
  return true;
}

function newLineStr(kind: ts.NewLineKind) {
  if (kind === ts.NewLineKind.CarriageReturnLineFeed) {
    return "\r\n";
  } else {
    return "\n";
  }
}

function getSeparator(sourceFile: ts.SourceFile, neighbor: ts.Node): string {
  const startPos = neighbor.getStart(sourceFile, true);
  const basis = sourceFile.getLineAndCharacterOfPosition(startPos);
  const lineStartPos = sourceFile.getPositionOfLineAndCharacter(basis.line, 0);
  const maybeIndentation = sourceFile
    .getText()
    .substring(lineStartPos, startPos);

  if (isIndentation(maybeIndentation)) {
    return `,${newLineStr(newLine)}${maybeIndentation}`;
  } else {
    return `, `;
  }
}

function insertAt<T extends ts.Node>(
  sourceFile: ts.SourceFile,
  nodes: ts.NodeArray<T>,
  index: number,
  node: T
): ts.SourceFile {
  if (index < 0 || index > nodes.length) {
    throw Error("Array index out of bounds");
  }

  let start: number;
  let end: number;
  let replacementText: string;
  if (nodes.length === 0) {
    // Replace entire range of nodes
    replacementText = printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      sourceFile
    );
    start = nodes.pos;
    end = nodes.end;
  } else if (index === nodes.length) {
    // Insert after last node
    const neighbor = nodes[nodes.length - 1];
    replacementText = `${getSeparator(sourceFile, neighbor)}${printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      sourceFile
    )}`;
    start = neighbor.end;
    end = start;
  } else {
    // Insert before node
    const neighbor = nodes[index];
    replacementText = `${printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      sourceFile
    )}${getSeparator(sourceFile, neighbor)}`;
    start = neighbor.getFullStart();
    end = start;
  }

  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${replacementText}${sourceFile.text.substring(end)}`;

  return sourceFile.update(newText, {
    span: {
      start,
      length: end - start,
    },
    newLength: replacementText.length,
  });
}

function removeAt<T extends ts.Node>(
  sourceFile: ts.SourceFile,
  nodes: ts.NodeArray<T>,
  index: number
): [sourceFile: ts.SourceFile, removed: T] {
  if (index < 0 || index >= nodes.length) {
    throw Error("Array index out of bounds");
  }

  const node = nodes[index];
  let start: number, end: number;

  if (index === nodes.length - 1) {
    // Remove until previous node
    const neighbor = nodes[index - 1];
    start = neighbor.end;
    end = node.end;
  } else {
    // Remove before next node
    const neighbor = nodes[index + 1];
    start = node.getFullStart();
    end = neighbor.getFullStart();
  }
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${sourceFile.text.substring(end)}`;

  return [
    sourceFile.update(newText, {
      span: {
        start,
        length: end - start,
      },
      newLength: 0,
    }),
    node,
  ];
}

function _add(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  key: string,
  value: StaticValue
): [sourceFile: ts.SourceFile, replaced?: ts.Node] {
  if (ts.isArrayLiteralExpression(node)) {
    const keyNum = key === "-" ? node.elements.length : parseArrayIndex(key);
    return [insertAt(sourceFile, node.elements, keyNum, toExpression(value))];
  } else if (ts.isObjectLiteralExpression(node)) {
    const existingAssignment = findObjectPropertyAssignment(node, key);
    if (result.isErr(existingAssignment)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(existingAssignment.error);
    }

    if (!existingAssignment.value) {
      return [
        insertAt(
          sourceFile,
          node.properties,
          node.properties.length,
          ts.factory.createPropertyAssignment(key, toExpression(value))
        ),
      ];
    } else {
      return [
        replaceNode(
          sourceFile,
          existingAssignment.value.initializer,
          toExpression(value)
        ),
        existingAssignment.value.initializer,
      ];
    }
  } else {
    throw Error("Cannot add to non-object/array");
  }
}

function parseArrayIndex(value: string) {
  if (!/^(0|[1-9][0-9]*)$/g.test(value)) {
    throw Error(`Invalid array index "${value}"`);
  }
  return Number(value);
}

function _replace(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  key: string,
  value: StaticValue
): [sourceFile: ts.SourceFile, replaced: ts.Node] {
  if (ts.isArrayLiteralExpression(node)) {
    const keyNum = parseArrayIndex(key);
    if (keyNum < 0 || keyNum >= node.elements.length) {
      throw Error("Array index out of bounds");
    }
    return replaceNodeValue(sourceFile, node.elements[keyNum], value);
  } else if (ts.isObjectLiteralExpression(node)) {
    const existingAssignment = findObjectPropertyAssignment(node, key);
    if (result.isErr(existingAssignment)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(existingAssignment.error);
    }

    if (!existingAssignment.value) {
      throw Error("Cannot replace object element which does not exist");
    }
    return replaceNodeValue(
      sourceFile,
      existingAssignment.value.initializer,
      value
    );
  } else {
    throw Error("Cannot replace item in non-object/array");
  }
}

function _remove(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  key: string
): [sourceFile: ts.SourceFile, removed: ts.Node] {
  if (ts.isArrayLiteralExpression(node)) {
    const keyNum = parseArrayIndex(key);
    if (keyNum < 0 || keyNum >= node.elements.length) {
      throw Error("Array index out of bounds");
    }
    return removeAt(sourceFile, node.elements, keyNum);
  } else if (ts.isObjectLiteralExpression(node)) {
    const assignment = findObjectPropertyAssignment(node, key);
    if (result.isErr(assignment)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(assignment.error);
    }
    if (!assignment.value) {
      throw Error("Cannot remove object element which does not exist");
    }

    return removeAt(
      sourceFile,
      node.properties,
      node.properties.indexOf(assignment.value)
    );
  } else {
    throw Error("Cannot remove from non-object/array");
  }
}

function getPointerFromPath(
  node: ts.Node,
  path: [string, ...string[]]
): [node: ts.Node, key: string] {
  let targetNode: ts.Node = node;
  let key: string = path[0];
  for (let i = 0; i < path.length - 1; ++i, key = path[i]) {
    const childNode = find(targetNode, key);
    if (result.isErr(childNode)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(childNode.error);
    }
    if (childNode.value === undefined) {
      throw Error("Path refers to non-existing object/array");
    }
    targetNode = childNode.value;
  }

  return [targetNode, key];
}

export function add(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  path: string[],
  value: StaticValue
): [removed: ts.SourceFile, replaced?: ts.Node] {
  if (path.length === 0) {
    throw Error("Cannot add to root");
  }

  const [targetNode, key] = getPointerFromPath(
    node,
    path as [string, ...string[]]
  );
  return _add(sourceFile, targetNode, key, value);
}

export function replace(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  path: string[],
  value: StaticValue
): [sourceFile: ts.SourceFile, replaced: ts.Node] {
  if (path.length === 0) {
    return replaceNodeValue(sourceFile, node, value);
  }

  const [targetNode, key] = getPointerFromPath(
    node,
    path as [string, ...string[]]
  );
  return _replace(sourceFile, targetNode, key, value);
}

export function remove(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  path: string[]
): [sourceFile: ts.SourceFile, removed: ts.Node] {
  if (path.length === 0) {
    throw Error("Cannot remove root");
  }

  const [targetNode, key] = getPointerFromPath(
    node,
    path as [string, ...string[]]
  );
  return _remove(sourceFile, targetNode, key);
}

function isProperPathPrefix(prefix: string[], path: string[]): boolean {
  if (prefix.length >= path.length) {
    // A proper prefix cannot be longer or have the same length as the path
    return false;
  }
  for (let i = 0; i < prefix.length; ++i) {
    if (prefix[i] !== path[i]) {
      return false;
    }
  }
  return true;
}

export function move(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  from: string[],
  path: string[]
) {
  // The "from" location MUST NOT be a proper prefix of the "path"
  // location; i.e., a location cannot be moved into one of its children.
  if (isProperPathPrefix(from, path)) {
    throw Error("A location cannot be moved into one of its children");
  }

  const [sourceFileWithRemoval, removedNode] = remove(sourceFile, node, from);
  const removedValue = evaluateExpression(removedNode);
  if (result.isErr(removedValue)) {
    throw Error(
      `Failed to evaluate moved value: ${JSON.stringify(
        flattenErrors(removedValue.error)
      )}`
    );
  }

  return add(sourceFileWithRemoval, node, path, removedValue.value);
}

function get(node: ts.Node, path: string[]): ts.Node {
  let targetNode: ts.Node = node;
  for (const key of path) {
    const childNode = find(targetNode, key);
    if (result.isErr(childNode)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(childNode.error);
    }
    if (childNode.value === undefined) {
      throw Error("Path refers to non-existing object/array");
    }
    targetNode = childNode.value;
  }

  return targetNode;
}

export function copy(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  from: string[],
  path: string[]
) {
  // The "from" location MUST NOT be a proper prefix of the "path"
  // location; i.e., a location cannot be moved into one of its children.
  if (isProperPathPrefix(from, path)) {
    throw Error("A location cannot be moved into one of its children");
  }

  const valueNode = get(node, from);
  const valueValue = evaluateExpression(valueNode);
  if (result.isErr(valueValue)) {
    throw Error(
      `Failed to evaluate copied value: ${JSON.stringify(
        flattenErrors(valueValue.error)
      )}`
    );
  }

  return add(sourceFile, node, path, valueValue.value);
}

function deepEqual(a: StaticValue, b: StaticValue) {
  if (a === b) {
    return true;
  }

  if (
    typeof a === "object" &&
    typeof b === "object" &&
    a !== null &&
    b !== null
  ) {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;

      for (let i = 0; i < a.length; ++i) {
        if (!deepEqual(a[i], b[i])) return false;
      }

      return true;
    } else if (!Array.isArray(a) && !Array.isArray(b)) {
      const aKeys = Object.keys(a).sort();
      {
        const bKeys = Object.keys(b).sort();

        if (aKeys.length !== bKeys.length) return false;
        for (let i = 0; i < aKeys.length; ++i) {
          if (aKeys[i] !== bKeys[i]) return false;
        }
      }

      for (const key of aKeys) {
        const valueA = a[key];
        const valueB = b[key];
        if (!deepEqual(valueA, valueB)) {
          return false;
        }
      }
    } else {
      return false;
    }
  }

  return false;
}

export function test(
  node: ts.Node,
  path: string[],
  value: StaticValue
): boolean {
  const valueNode = get(node, path);
  const valueValue = evaluateExpression(valueNode);
  if (result.isErr(valueValue)) {
    throw Error(
      `Failed to evaluate tested value: ${JSON.stringify(
        flattenErrors(valueValue.error)
      )}`
    );
  }
  return deepEqual(value, valueValue.value);
}
