import { ValidTypes } from "@valbuild/lib";
import ts from "typescript";
import { find, findObjectPropertyAssignment, flattenErrors } from "./analysis";
import * as result from "./result";

// TODO: Can we do some fancy formatting for the write operations?
function removeNode(sourceFile: ts.SourceFile, node: ts.Node): ts.SourceFile {
  const start = node.getStart(sourceFile, true);
  const end = node.end;
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${sourceFile.text.substring(end)}`;

  ts.getDefaultFormatCodeSettings();

  return sourceFile.update(newText, {
    span: {
      start,
      length: end - start,
    },
    newLength: 0,
  });
}

function replaceNodeValue(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  value: ValidTypes
): ts.SourceFile {
  const valueJSON = JSON.stringify(value);
  const start = node.getStart(sourceFile, false);
  const end = node.end;
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${valueJSON}${sourceFile.text.substring(end)}`;

  return sourceFile.update(newText, {
    span: {
      start,
      length: end - start,
    },
    newLength: valueJSON.length,
  });
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
): ts.SourceFile {
  if (ts.isArrayLiteralExpression(node)) {
    if (key === "-") {
      if (node.elements.length === 0) {
        return replaceNodeValue(sourceFile, node, [value]);
      } else {
        return insertAfter(
          sourceFile,
          node.elements[node.elements.length - 1],
          value
        );
      }
    } else {
      const keyNum = parseInt(key);
      if (keyNum < 0 || keyNum >= node.elements.length) {
        throw Error("Array index out of bounds");
      }
      return insertBefore(sourceFile, node.elements[keyNum], value);
    }
  } else if (ts.isObjectLiteralExpression(node)) {
    const existingAssignment = findObjectPropertyAssignment(node, key);
    if (result.isErr(existingAssignment)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(existingAssignment.error);
    }

    if (!existingAssignment.value) {
      if (node.properties.length === 0) {
        return replaceNodeValue(sourceFile, node, { [key]: value });
      } else {
        return insertAfter(
          sourceFile,
          node.properties[node.properties.length - 1],
          value,
          `${JSON.stringify(key)}: `
        );
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
): ts.SourceFile {
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
): ts.SourceFile {
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

function getAssignableFromPath(
  node: ts.Node,
  path: [string, ...string[]]
): [node: ts.Node, key: string] {
  let targetNode: ts.Node | undefined = node;
  let key: string = path[0];
  for (let i = 0; i < path.length - 1; ++i, key = path[i]) {
    const childNode = find(targetNode, key);
    if (result.isErr(childNode)) {
      // TODO: Improve this error handling logic
      throw flattenErrors(childNode.error);
    }
    targetNode = childNode.value;
    if (targetNode === undefined) {
      throw Error("Path refers to non-existing object/array");
    }
  }

  return [targetNode, key];
}

export function add(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  path: string[],
  value: ValidTypes
): ts.SourceFile {
  if (path.length === 0) {
    throw Error("Cannot add to root");
  }

  const [targetNode, key] = getAssignableFromPath(
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
): ts.SourceFile {
  if (path.length === 0) {
    return replaceNodeValue(sourceFile, node, value);
  }

  const [targetNode, key] = getAssignableFromPath(
    node,
    path as [string, ...string[]]
  );
  return _replace(sourceFile, targetNode, key, value);
}

export function remove(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  path: string[]
): ts.SourceFile {
  if (path.length === 0) {
    throw Error("Cannot remove root");
  }

  const [targetNode, key] = getAssignableFromPath(
    node,
    path as [string, ...string[]]
  );
  return _remove(sourceFile, targetNode, key);
}
