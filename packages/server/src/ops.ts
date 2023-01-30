import { ValidTypes } from "@valbuild/lib";
import ts from "typescript";
import {
  evaluateExpression,
  find,
  findObjectPropertyAssignment,
  flattenErrors,
} from "./analysis";
import * as result from "./result";

// TODO: Can we do some fancy formatting for the write operations?
function removeNode(
  sourceFile: ts.SourceFile,
  node: ts.Node
): [sourceFile: ts.SourceFile, removed: ts.Node] {
  const start = node.getStart(sourceFile, true);
  const end = node.end;
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${sourceFile.text.substring(end)}`;

  ts.getDefaultFormatCodeSettings();

  return [
    sourceFile.update(newText, {
      span: {
        start,
        length: end - start,
      },
      newLength: 0,
    }),
    ts.isPropertyAssignment(node) ? node.initializer : node,
  ];
}

function replaceNodeValue(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  value: ValidTypes
): [sourceFile: ts.SourceFile, replaced: ts.Node] {
  const valueJSON = JSON.stringify(value);
  const start = node.getStart(sourceFile, false);
  const end = node.end;
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${valueJSON}${sourceFile.text.substring(end)}`;

  return [
    sourceFile.update(newText, {
      span: {
        start,
        length: end - start,
      },
      newLength: valueJSON.length,
    }),
    node,
  ];
}

function insertAfter(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  value: ValidTypes,
  prefix = ""
): ts.SourceFile {
  const replacement = `, ${prefix}${JSON.stringify(value)}`;
  const start = node.end;
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${replacement}${sourceFile.text.substring(start)}`;

  return sourceFile.update(newText, {
    span: {
      start,
      length: 0,
    },
    newLength: replacement.length,
  });
}

function insertBefore(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  value: ValidTypes,
  prefix = ""
): ts.SourceFile {
  const replacement = `${prefix}${JSON.stringify(value)}, `;
  const start = node.getStart(sourceFile, true);
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${replacement}${sourceFile.text.substring(start)}`;

  return sourceFile.update(newText, {
    span: {
      start,
      length: 0,
    },
    newLength: replacement.length,
  });
}

function _add(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  key: string,
  value: ValidTypes
): [sourceFile: ts.SourceFile, replaced?: ts.Node] {
  if (ts.isArrayLiteralExpression(node)) {
    if (key === "-") {
      if (node.elements.length === 0) {
        return [replaceNodeValue(sourceFile, node, [value])[0]];
      } else {
        return [
          insertAfter(
            sourceFile,
            node.elements[node.elements.length - 1],
            value
          ),
        ];
      }
    } else {
      const keyNum = parseInt(key);
      if (keyNum < 0 || keyNum >= node.elements.length) {
        throw Error("Array index out of bounds");
      }
      return [insertBefore(sourceFile, node.elements[keyNum], value)];
    }
  } else if (ts.isObjectLiteralExpression(node)) {
    const existingAssignment = findObjectPropertyAssignment(node, key);
    if (result.isErr(existingAssignment)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(existingAssignment.error);
    }

    if (!existingAssignment.value) {
      if (node.properties.length === 0) {
        return [replaceNodeValue(sourceFile, node, { [key]: value })[0]];
      } else {
        return [
          insertAfter(
            sourceFile,
            node.properties[node.properties.length - 1],
            value,
            `${JSON.stringify(key)}: `
          ),
        ];
      }
    } else {
      return replaceNodeValue(
        sourceFile,
        existingAssignment.value.initializer,
        value
      );
    }
  } else {
    throw Error("Cannot add to non-object/array");
  }
}

function _replace(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  key: string,
  value: ValidTypes
): [sourceFile: ts.SourceFile, replaced: ts.Node] {
  if (ts.isArrayLiteralExpression(node)) {
    const keyNum = parseInt(key);
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
    const keyNum = parseInt(key);
    if (keyNum < 0 || keyNum >= node.elements.length) {
      throw Error("Array index out of bounds");
    }
    return removeNode(sourceFile, node.elements[keyNum]);
  } else if (ts.isObjectLiteralExpression(node)) {
    const assignment = findObjectPropertyAssignment(node, key);
    if (result.isErr(assignment)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(assignment.error);
    }
    if (!assignment.value) {
      throw Error("Cannot remove object element which does not exist");
    }
    return removeNode(sourceFile, assignment.value);
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
  value: ValidTypes
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
  value: ValidTypes
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

function deepEqual(a: ValidTypes, b: ValidTypes) {
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
  value: ValidTypes
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
