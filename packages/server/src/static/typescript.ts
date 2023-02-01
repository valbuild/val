import ts from "typescript";
import * as result from "../result";
import { pipe } from "../fp";
import {
  evaluateExpression,
  findObjectPropertyAssignment,
  ValSyntaxErrorTree,
} from "./analysis";
import {
  deepEqual,
  isNotRoot,
  isProperPathPrefix,
  Ops,
  PatchError,
  StaticValue,
} from "./ops";

type TSOpsResult<T> = result.Result<T, PatchError | ValSyntaxErrorTree>;

declare module "typescript" {
  interface PrinterOptions {
    neverAsciiEscape?: boolean;
  }
}

function toExpression(value: StaticValue): ts.Expression {
  if (typeof value === "string") {
    // TODO: Use configuration/heuristics to determine use of single quote or double quote
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

// TODO: Choose newline based on project settings/heuristics/system default?
const newLine = ts.NewLineKind.LineFeed;
// TODO: Handle indentation of printed code
const printer = ts.createPrinter({
  newLine: newLine,
  // neverAsciiEscape: true,
});

function replaceNode(
  document: ts.SourceFile,
  node: ts.Node,
  replacement: ts.Node
): ts.SourceFile {
  const replacementText = printer.printNode(
    ts.EmitHint.Unspecified,
    replacement,
    document
  );
  const start = node.getFullStart();
  const end = node.end;
  const newText = `${document.text.substring(
    0,
    start
  )}${replacementText}${document.text.substring(end)}`;

  return document.update(newText, {
    span: {
      start,
      length: end - start,
    },
    newLength: replacementText.length,
  });
}

function replaceNodeValue(
  document: ts.SourceFile,
  node: ts.Node,
  value: StaticValue
): [document: ts.SourceFile, replaced: ts.Node] {
  const replacementText = printer.printNode(
    ts.EmitHint.Unspecified,
    toExpression(value),
    document
  );
  const start = node.getStart(document, false);
  const end = node.end;
  const newText = `${document.text.substring(
    0,
    start
  )}${replacementText}${document.text.substring(end)}`;

  return [
    document.update(newText, {
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

function getSeparator(document: ts.SourceFile, neighbor: ts.Node): string {
  const startPos = neighbor.getStart(document, true);
  const basis = document.getLineAndCharacterOfPosition(startPos);
  const lineStartPos = document.getPositionOfLineAndCharacter(basis.line, 0);
  const maybeIndentation = document.getText().substring(lineStartPos, startPos);

  if (isIndentation(maybeIndentation)) {
    return `,${newLineStr(newLine)}${maybeIndentation}`;
  } else {
    return `, `;
  }
}

function insertAt<T extends ts.Node>(
  document: ts.SourceFile,
  nodes: ts.NodeArray<T>,
  index: number,
  node: T
): ts.SourceFile {
  let start: number;
  let end: number;
  let replacementText: string;
  if (nodes.length === 0) {
    // Replace entire range of nodes
    replacementText = printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      document
    );
    start = nodes.pos;
    end = nodes.end;
  } else if (index === nodes.length) {
    // Insert after last node
    const neighbor = nodes[nodes.length - 1];
    replacementText = `${getSeparator(document, neighbor)}${printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      document
    )}`;
    start = neighbor.end;
    end = start;
  } else {
    // Insert before node
    const neighbor = nodes[index];
    replacementText = `${printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      document
    )}${getSeparator(document, neighbor)}`;
    start = neighbor.getStart(document, true);
    end = start;
  }

  const newText = `${document.text.substring(
    0,
    start
  )}${replacementText}${document.text.substring(end)}`;

  return document.update(newText, {
    span: {
      start,
      length: end - start,
    },
    newLength: replacementText.length,
  });
}

function removeAt<T extends ts.Node>(
  document: ts.SourceFile,
  nodes: ts.NodeArray<T>,
  index: number
): [document: ts.SourceFile, removed: T] {
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
    start = node.getStart(document, true);
    end = neighbor.getStart(document, true);
  }
  const newText = `${document.text.substring(
    0,
    start
  )}${document.text.substring(end)}`;

  return [
    document.update(newText, {
      span: {
        start,
        length: end - start,
      },
      newLength: 0,
    }),
    node,
  ];
}

function parseAndValidateArrayIndex(
  value: string
): result.Result<number, PatchError> {
  if (!/^(0|[1-9][0-9]*)$/g.test(value)) {
    return result.err(new PatchError(`Invalid array index "${value}"`));
  }
  return result.ok(Number(value));
}

function parseAndValidateArrayInsertIndex(
  key: string,
  length: number
): result.Result<number, PatchError> {
  if (key === "-") {
    return result.ok(length);
  }

  return pipe(
    parseAndValidateArrayIndex(key),
    result.flatMap((index: number) => {
      if (index < 0 || index > length) {
        return result.err(new PatchError("Array index out of bounds"));
      } else {
        return result.ok(index);
      }
    })
  );
}

function parseAndValidateArrayInboundsIndex(
  key: string,
  length: number
): result.Result<number, PatchError> {
  return pipe(
    parseAndValidateArrayIndex(key),
    result.flatMap((index: number) => {
      if (index < 0 || index >= length) {
        return result.err(new PatchError("Array index out of bounds"));
      } else {
        return result.ok(index);
      }
    })
  );
}

function replaceInNode(
  document: ts.SourceFile,
  node: ts.Node,
  key: string,
  value: StaticValue
): TSOpsResult<[document: ts.SourceFile, replaced: ts.Node]> {
  if (ts.isArrayLiteralExpression(node)) {
    return pipe(
      parseAndValidateArrayInboundsIndex(key, node.elements.length),
      result.map((index: number) =>
        replaceNodeValue(document, node.elements[index], value)
      )
    );
  } else if (ts.isObjectLiteralExpression(node)) {
    return pipe(
      findObjectPropertyAssignment(node, key),
      result.flatMap((assignment): TSOpsResult<ts.PropertyAssignment> => {
        if (!assignment) {
          return result.err(
            new PatchError("Cannot replace object element which does not exist")
          );
        }
        return result.ok(assignment);
      }),
      result.map((assignment: ts.PropertyAssignment) =>
        replaceNodeValue(document, assignment.initializer, value)
      )
    );
  } else {
    return result.err(new PatchError("Cannot add to non-object/array"));
  }
}

export function getFromNode(
  node: ts.Node,
  key: string
): TSOpsResult<ts.Expression | undefined> {
  if (ts.isArrayLiteralExpression(node)) {
    return pipe(
      parseAndValidateArrayInboundsIndex(key, node.elements.length),
      result.map((index: number) => node.elements[index])
    );
  } else if (ts.isObjectLiteralExpression(node)) {
    return pipe(
      findObjectPropertyAssignment(node, key),
      result.map(
        (assignment: ts.PropertyAssignment | undefined) =>
          assignment?.initializer
      )
    );
  } else {
    return result.err(new PatchError("Cannot access non-object/array"));
  }
}

type Pointer = [node: ts.Node, key: string];
function getPointerFromPath(
  node: ts.Node,
  path: [string, ...string[]]
): TSOpsResult<Pointer> {
  let targetNode: ts.Node = node;
  let key: string = path[0];
  for (let i = 0; i < path.length - 1; ++i, key = path[i]) {
    const childNode = getFromNode(targetNode, key);
    if (result.isErr(childNode)) {
      return childNode;
    }
    if (childNode.value === undefined) {
      throw Error("Path refers to non-existing object/array");
    }
    targetNode = childNode.value;
  }

  return result.ok([targetNode, key]);
}

function getAtPath(rootNode: ts.Node, path: string[]): TSOpsResult<ts.Node> {
  return result.flatMapReduce((node: ts.Node, key: string) =>
    pipe(
      getFromNode(node, key),
      result.flatMap((childNode: ts.Node | undefined) => {
        if (childNode) {
          return result.ok(childNode);
        } else {
          return result.err(
            new PatchError("Path refers to non-existing object/array")
          );
        }
      })
    )
  )(path, rootNode);
}

function removeFromNode(
  document: ts.SourceFile,
  node: ts.Node,
  key: string
): TSOpsResult<[document: ts.SourceFile, removed: ts.Node]> {
  if (ts.isArrayLiteralExpression(node)) {
    return pipe(
      parseAndValidateArrayInboundsIndex(key, node.elements.length),
      result.map((index: number) => removeAt(document, node.elements, index))
    );
  } else if (ts.isObjectLiteralExpression(node)) {
    return pipe(
      findObjectPropertyAssignment(node, key),
      result.flatMap(
        (
          assignment: ts.PropertyAssignment | undefined
        ): TSOpsResult<ts.PropertyAssignment> => {
          if (!assignment) {
            return result.err(
              new PatchError(
                "Cannot replace object element which does not exist"
              )
            );
          }
          return result.ok(assignment);
        }
      ),
      result.map((assignment: ts.PropertyAssignment) =>
        removeAt(document, node.properties, node.properties.indexOf(assignment))
      )
    );
  } else {
    return result.err(new PatchError("Cannot remove from non-object/array"));
  }
}

function removeAtPath(
  document: ts.SourceFile,
  rootNode: ts.Node,
  path: [string, ...string[]]
): TSOpsResult<[document: ts.SourceFile, removed: ts.Node]> {
  return pipe(
    getPointerFromPath(rootNode, path),
    result.flatMap(([node, key]: Pointer) =>
      removeFromNode(document, node, key)
    )
  );
}

function addToNode(
  document: ts.SourceFile,
  node: ts.Node,
  key: string,
  value: StaticValue
): TSOpsResult<[document: ts.SourceFile, replaced?: ts.Node]> {
  if (ts.isArrayLiteralExpression(node)) {
    return pipe(
      parseAndValidateArrayInsertIndex(key, node.elements.length),
      result.map((index: number): [document: ts.SourceFile] => [
        insertAt(document, node.elements, index, toExpression(value)),
      ])
    );
  } else if (ts.isObjectLiteralExpression(node)) {
    return pipe(
      findObjectPropertyAssignment(node, key),
      result.map(
        (
          assignment: ts.PropertyAssignment | undefined
        ): [document: ts.SourceFile, replaced?: ts.Node] => {
          if (!assignment) {
            return [
              insertAt(
                document,
                node.properties,
                node.properties.length,
                ts.factory.createPropertyAssignment(key, toExpression(value))
              ),
            ];
          } else {
            return [
              replaceNode(
                document,
                assignment.initializer,
                toExpression(value)
              ),
              assignment.initializer,
            ];
          }
        }
      )
    );
  } else {
    return result.err(new PatchError("Cannot add to non-object/array"));
  }
}

function addAtPath(
  document: ts.SourceFile,
  rootNode: ts.Node,
  path: [string, ...string[]],
  value: StaticValue
): TSOpsResult<[document: ts.SourceFile, replaced?: ts.Node]> {
  return pipe(
    getPointerFromPath(rootNode, path),
    result.flatMap(([node, key]: Pointer) =>
      addToNode(document, node, key, value)
    )
  );
}

function pickDocument<
  T extends readonly [document: ts.SourceFile, ...rest: unknown[]]
>([sourceFile]: T) {
  return sourceFile;
}

export class TSOps implements Ops<ts.SourceFile, ValSyntaxErrorTree> {
  constructor(private rootNode: ts.Node) {}

  add(
    document: ts.SourceFile,
    path: string[],
    value: StaticValue
  ): TSOpsResult<ts.SourceFile> {
    if (!isNotRoot(path)) {
      return result.err(new PatchError("Cannot add root"));
    }

    return pipe(
      addAtPath(document, this.rootNode, path, value),
      result.map(pickDocument)
    );
  }
  remove(document: ts.SourceFile, path: string[]): TSOpsResult<ts.SourceFile> {
    if (!isNotRoot(path)) {
      return result.err(new PatchError("Cannot remove root"));
    }

    return pipe(
      removeAtPath(document, this.rootNode, path),
      result.map(pickDocument)
    );
  }
  replace(
    document: ts.SourceFile,
    path: string[],
    value: StaticValue
  ): TSOpsResult<ts.SourceFile> {
    if (!isNotRoot(path)) {
      return result.err(new PatchError("Cannot replace root"));
    }

    return pipe(
      getPointerFromPath(this.rootNode, path),
      result.flatMap(([targetNode, key]: Pointer) =>
        replaceInNode(document, targetNode, key, value)
      ),
      result.map(pickDocument)
    );
  }
  move(
    document: ts.SourceFile,
    from: string[],
    path: string[]
  ): TSOpsResult<ts.SourceFile> {
    if (!isNotRoot(from)) {
      return result.err(new PatchError("Cannot move from root"));
    }

    if (!isNotRoot(path)) {
      return result.err(new PatchError("Cannot move to root"));
    }

    // The "from" location MUST NOT be a proper prefix of the "path"
    // location; i.e., a location cannot be moved into one of its children.
    if (isProperPathPrefix(from, path)) {
      return result.err(
        new PatchError("A location cannot be moved into one of its childen")
      );
    }

    return pipe(
      removeAtPath(document, this.rootNode, from),
      result.flatMap(
        ([doc, removedNode]: [doc: ts.SourceFile, removedNode: ts.Node]) =>
          pipe(
            evaluateExpression(removedNode),
            result.map(
              (
                removedValue: StaticValue
              ): [doc: ts.SourceFile, removedValue: StaticValue] => [
                doc,
                removedValue,
              ]
            )
          )
      ),
      result.flatMap(
        ([doc, removedValue]: [
          doc: ts.SourceFile,
          removedValue: StaticValue
        ]) => addAtPath(doc, this.rootNode, path, removedValue)
      ),
      result.map(pickDocument)
    );
  }
  copy(
    document: ts.SourceFile,
    from: string[],
    path: string[]
  ): TSOpsResult<ts.SourceFile> {
    if (!isNotRoot(from)) {
      return result.err(new PatchError("Cannot copy from root"));
    }

    if (!isNotRoot(path)) {
      return result.err(new PatchError("Cannot copy to root"));
    }

    // The "from" location MUST NOT be a proper prefix of the "path"
    // location; i.e., a location cannot be moved into one of its children.
    if (isProperPathPrefix(from, path)) {
      return result.err(
        new PatchError("A location cannot be moved into one of its childen")
      );
    }

    return pipe(
      getAtPath(this.rootNode, from),
      result.flatMap(evaluateExpression),
      result.flatMap((value: StaticValue) =>
        addAtPath(document, this.rootNode, path, value)
      ),
      result.map(pickDocument)
    );
  }
  test(
    _document: ts.SourceFile,
    path: string[],
    value: StaticValue
  ): TSOpsResult<boolean> {
    return pipe(
      getAtPath(this.rootNode, path),
      result.flatMap(evaluateExpression),
      result.map((documentValue: StaticValue) =>
        deepEqual(value, documentValue)
      )
    );
  }
}
