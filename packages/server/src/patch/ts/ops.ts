import ts from "typescript";
import * as result from "../../fp/result";
import { pipe } from "../../fp/util";
import {
  validateInitializers,
  evaluateExpression,
  findObjectPropertyAssignment,
  ValSyntaxErrorTree,
  shallowValidateExpression,
} from "./syntax";
import {
  deepEqual,
  isNotRoot,
  isProperPathPrefix,
  Ops,
  PatchError,
  JSONValue,
} from "../ops";

type TSOpsResult<T> = result.Result<T, PatchError | ValSyntaxErrorTree>;

declare module "typescript" {
  interface PrinterOptions {
    neverAsciiEscape?: boolean;
  }
}

function toExpression(value: JSONValue): ts.Expression {
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

function replaceNodeValue<T extends ts.Node>(
  document: ts.SourceFile,
  node: T,
  value: JSONValue
): [document: ts.SourceFile, replaced: T] {
  const replacementText = printer.printNode(
    ts.EmitHint.Unspecified,
    toExpression(value),
    document
  );
  const span = ts.createTextSpanFromBounds(
    node.getStart(document, false),
    node.end
  );
  const newText = `${document.text.substring(
    0,
    span.start
  )}${replacementText}${document.text.substring(ts.textSpanEnd(span))}`;

  return [
    document.update(
      newText,
      ts.createTextChangeRange(span, replacementText.length)
    ),
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
  let span: ts.TextSpan;
  let replacementText: string;
  if (nodes.length === 0) {
    // Replace entire range of nodes
    replacementText = printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      document
    );
    span = ts.createTextSpanFromBounds(nodes.pos, nodes.end);
  } else if (index === nodes.length) {
    // Insert after last node
    const neighbor = nodes[nodes.length - 1];
    replacementText = `${getSeparator(document, neighbor)}${printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      document
    )}`;
    span = ts.createTextSpan(neighbor.end, 0);
  } else {
    // Insert before node
    const neighbor = nodes[index];
    replacementText = `${printer.printNode(
      ts.EmitHint.Unspecified,
      node,
      document
    )}${getSeparator(document, neighbor)}`;
    span = ts.createTextSpan(neighbor.getStart(document, true), 0);
  }

  const newText = `${document.text.substring(
    0,
    span.start
  )}${replacementText}${document.text.substring(ts.textSpanEnd(span))}`;

  return document.update(
    newText,
    ts.createTextChangeRange(span, replacementText.length)
  );
}

function removeAt<T extends ts.Node>(
  document: ts.SourceFile,
  nodes: ts.NodeArray<T>,
  index: number
): [document: ts.SourceFile, removed: T] {
  const node = nodes[index];
  let span: ts.TextSpan;

  if (nodes.length === 1) {
    span = ts.createTextSpanFromBounds(nodes.pos, nodes.end);
  } else if (index === nodes.length - 1) {
    // Remove until previous node
    const neighbor = nodes[index - 1];
    span = ts.createTextSpanFromBounds(neighbor.end, node.end);
  } else {
    // Remove before next node
    const neighbor = nodes[index + 1];
    span = ts.createTextSpanFromBounds(
      node.getStart(document, true),
      neighbor.getStart(document, true)
    );
  }
  const newText = `${document.text.substring(
    0,
    span.start
  )}${document.text.substring(ts.textSpanEnd(span))}`;

  return [document.update(newText, ts.createTextChangeRange(span, 0)), node];
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
  nodes: ReadonlyArray<ts.Expression>
): TSOpsResult<number> {
  if (key === "-") {
    // For insertion, all nodes up until the insertion index must be valid
    // initializers
    const err = validateInitializers(nodes);
    if (err) {
      return result.err(err);
    }
    return result.ok(nodes.length);
  }

  return pipe(
    parseAndValidateArrayIndex(key),
    result.flatMap((index: number): TSOpsResult<number> => {
      // For insertion, all nodes up until the insertion index must be valid
      // initializers
      const err = validateInitializers(nodes.slice(0, index));
      if (err) {
        return result.err(err);
      }
      if (index < 0 || index > nodes.length) {
        return result.err(new PatchError("Array index out of bounds"));
      } else {
        return result.ok(index);
      }
    })
  );
}

function parseAndValidateArrayInboundsIndex(
  key: string,
  nodes: ReadonlyArray<ts.Expression>
): TSOpsResult<number> {
  return pipe(
    parseAndValidateArrayIndex(key),
    result.flatMap((index: number): TSOpsResult<number> => {
      // For in-bounds operations, all nodes up until and including the index
      // must be valid initializers
      const err = validateInitializers(nodes.slice(0, index + 1));
      if (err) {
        return result.err(err);
      }
      if (index < 0 || index >= nodes.length) {
        return result.err(new PatchError("Array index out of bounds"));
      } else {
        return result.ok(index);
      }
    })
  );
}

function replaceInNode(
  document: ts.SourceFile,
  node: ts.Expression,
  key: string,
  value: JSONValue
): TSOpsResult<[document: ts.SourceFile, replaced: ts.Expression]> {
  if (ts.isArrayLiteralExpression(node)) {
    return pipe(
      parseAndValidateArrayInboundsIndex(key, node.elements),
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
    return result.err(
      shallowValidateExpression(node) ??
        new PatchError("Cannot add to non-object/array")
    );
  }
}

function replaceAtPath(
  document: ts.SourceFile,
  rootNode: ts.Expression,
  path: string[],
  value: JSONValue
): TSOpsResult<[document: ts.SourceFile, replaced: ts.Expression]> {
  if (isNotRoot(path)) {
    return pipe(
      getPointerFromPath(rootNode, path),
      result.flatMap(([node, key]: Pointer) =>
        replaceInNode(document, node, key, value)
      )
    );
  } else {
    return result.ok(replaceNodeValue(document, rootNode, value));
  }
}

export function getFromNode(
  node: ts.Expression,
  key: string
): TSOpsResult<ts.Expression | undefined> {
  if (ts.isArrayLiteralExpression(node)) {
    return pipe(
      parseAndValidateArrayInboundsIndex(key, node.elements),
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
    return result.err(
      shallowValidateExpression(node) ??
        new PatchError("Cannot access non-object/array")
    );
  }
}

type Pointer = [node: ts.Expression, key: string];
function getPointerFromPath(
  node: ts.Expression,
  path: [string, ...string[]]
): TSOpsResult<Pointer> {
  let targetNode: ts.Expression = node;
  let key: string = path[0];
  for (let i = 0; i < path.length - 1; ++i, key = path[i]) {
    const childNode = getFromNode(targetNode, key);
    if (result.isErr(childNode)) {
      return childNode;
    }
    if (childNode.value === undefined) {
      return result.err(
        new PatchError("Path refers to non-existing object/array")
      );
    }
    targetNode = childNode.value;
  }

  return result.ok([targetNode, key]);
}

function getAtPath(
  rootNode: ts.Expression,
  path: string[]
): TSOpsResult<ts.Expression> {
  return result.flatMapReduce((node: ts.Expression, key: string) =>
    pipe(
      getFromNode(node, key),
      result.flatMap((childNode: ts.Expression | undefined) => {
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
  node: ts.Expression,
  key: string
): TSOpsResult<[document: ts.SourceFile, removed: ts.Expression]> {
  if (ts.isArrayLiteralExpression(node)) {
    return pipe(
      parseAndValidateArrayInboundsIndex(key, node.elements),
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
      result.map((assignment: ts.PropertyAssignment) => [
        removeAt(
          document,
          node.properties,
          node.properties.indexOf(assignment)
        )[0],
        assignment.initializer,
      ])
    );
  } else {
    return result.err(
      shallowValidateExpression(node) ??
        new PatchError("Cannot remove from non-object/array")
    );
  }
}

function removeAtPath(
  document: ts.SourceFile,
  rootNode: ts.Expression,
  path: [string, ...string[]]
): TSOpsResult<[document: ts.SourceFile, removed: ts.Expression]> {
  return pipe(
    getPointerFromPath(rootNode, path),
    result.flatMap(([node, key]: Pointer) =>
      removeFromNode(document, node, key)
    )
  );
}

function addToNode(
  document: ts.SourceFile,
  node: ts.Expression,
  key: string,
  value: JSONValue
): TSOpsResult<[document: ts.SourceFile, replaced?: ts.Expression]> {
  if (ts.isArrayLiteralExpression(node)) {
    return pipe(
      parseAndValidateArrayInsertIndex(key, node.elements),
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
        ): [document: ts.SourceFile, replaced?: ts.Expression] => {
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
            return replaceNodeValue(document, assignment.initializer, value);
          }
        }
      )
    );
  } else {
    return result.err(
      shallowValidateExpression(node) ??
        new PatchError("Cannot add to non-object/array")
    );
  }
}

function addAtPath(
  document: ts.SourceFile,
  rootNode: ts.Expression,
  path: string[],
  value: JSONValue
): TSOpsResult<[document: ts.SourceFile, replaced?: ts.Expression]> {
  if (isNotRoot(path)) {
    return pipe(
      getPointerFromPath(rootNode, path),
      result.flatMap(([node, key]: Pointer) =>
        addToNode(document, node, key, value)
      )
    );
  } else {
    return result.ok(replaceNodeValue(document, rootNode, value));
  }
}

function pickDocument<
  T extends readonly [document: ts.SourceFile, ...rest: unknown[]]
>([sourceFile]: T) {
  return sourceFile;
}

export class TSOps implements Ops<ts.SourceFile, ValSyntaxErrorTree> {
  constructor(
    private findRoot: (
      document: ts.SourceFile
    ) => result.Result<ts.Expression, ValSyntaxErrorTree>
  ) {}

  add(
    document: ts.SourceFile,
    path: string[],
    value: JSONValue
  ): TSOpsResult<ts.SourceFile> {
    return pipe(
      document,
      this.findRoot,
      result.flatMap((rootNode: ts.Expression) =>
        addAtPath(document, rootNode, path, value)
      ),
      result.map(pickDocument)
    );
  }
  remove(document: ts.SourceFile, path: string[]): TSOpsResult<ts.SourceFile> {
    if (!isNotRoot(path)) {
      return result.err(new PatchError("Cannot remove root"));
    }

    return pipe(
      document,
      this.findRoot,
      result.flatMap((rootNode: ts.Expression) =>
        removeAtPath(document, rootNode, path)
      ),
      result.map(pickDocument)
    );
  }
  replace(
    document: ts.SourceFile,
    path: string[],
    value: JSONValue
  ): TSOpsResult<ts.SourceFile> {
    return pipe(
      document,
      this.findRoot,
      result.flatMap((rootNode: ts.Expression) =>
        replaceAtPath(document, rootNode, path, value)
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

    // The "from" location MUST NOT be a proper prefix of the "path"
    // location; i.e., a location cannot be moved into one of its children.
    if (isProperPathPrefix(from, path)) {
      return result.err(
        new PatchError("A location cannot be moved into one of its childen")
      );
    }

    return pipe(
      document,
      this.findRoot,
      result.flatMap((rootNode: ts.Expression) =>
        removeAtPath(document, rootNode, from)
      ),
      result.flatMap(
        ([doc, removedNode]: [
          doc: ts.SourceFile,
          removedNode: ts.Expression
        ]) =>
          pipe(
            evaluateExpression(removedNode),
            result.map(
              (
                removedValue: JSONValue
              ): [doc: ts.SourceFile, removedValue: JSONValue] => [
                doc,
                removedValue,
              ]
            )
          )
      ),
      result.flatMap(
        ([document, removedValue]: [
          document: ts.SourceFile,
          removedValue: JSONValue
        ]) =>
          pipe(
            document,
            this.findRoot,
            result.flatMap((root: ts.Expression) =>
              addAtPath(document, root, path, removedValue)
            )
          )
      ),
      result.map(pickDocument)
    );
  }
  copy(
    document: ts.SourceFile,
    from: string[],
    path: string[]
  ): TSOpsResult<ts.SourceFile> {
    return pipe(
      document,
      this.findRoot,
      result.flatMap((rootNode: ts.Expression) =>
        pipe(
          getAtPath(rootNode, from),
          result.flatMap(evaluateExpression),
          result.flatMap((value: JSONValue) =>
            addAtPath(document, rootNode, path, value)
          )
        )
      ),
      result.map(pickDocument)
    );
  }
  test(
    document: ts.SourceFile,
    path: string[],
    value: JSONValue
  ): TSOpsResult<boolean> {
    return pipe(
      document,
      this.findRoot,
      result.flatMap((rootNode: ts.Expression) => getAtPath(rootNode, path)),
      result.flatMap(evaluateExpression),
      result.map((documentValue: JSONValue) => deepEqual(value, documentValue))
    );
  }
}
