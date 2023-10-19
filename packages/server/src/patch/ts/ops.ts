import ts from "typescript";
import { result, array, pipe } from "@valbuild/core/fp";
import {
  validateInitializers,
  evaluateExpression,
  findObjectPropertyAssignment,
  ValSyntaxErrorTree,
  shallowValidateExpression,
  isValFileMethodCall,
  findValFileNodeArg,
  findValFileMetadataArg,
} from "./syntax";
import {
  deepEqual,
  isNotRoot,
  Ops,
  PatchError,
  JSONValue,
  parseAndValidateArrayIndex,
} from "@valbuild/core/patch";
import {
  AnyRichTextOptions,
  FILE_REF_PROP,
  FileSource,
  RichTextSource,
  VAL_EXTENSION,
} from "@valbuild/core";
import { JsonPrimitive } from "@valbuild/core/src/Json";
import { Internal } from "@valbuild/core";
import { LinkSource } from "@valbuild/core/src/source/link";

type TSOpsResult<T> = result.Result<T, PatchError | ValSyntaxErrorTree>;

declare module "typescript" {
  interface PrinterOptions {
    /**
     * Internal option that stops printing unnecessary ASCII escape sequences
     * in strings, though it might have unintended effects. Might be useful?
     */
    neverAsciiEscape?: boolean;
  }
}

function isValidIdentifier(text: string): boolean {
  if (text.length === 0) {
    return false;
  }

  if (!ts.isIdentifierStart(text.charCodeAt(0), ts.ScriptTarget.ES2020)) {
    return false;
  }

  for (let i = 1; i < text.length; ++i) {
    if (!ts.isIdentifierPart(text.charCodeAt(i), ts.ScriptTarget.ES2020)) {
      return false;
    }
  }

  return true;
}

function createPropertyAssignment(key: string, value: JSONValue) {
  return ts.factory.createPropertyAssignment(
    isValidIdentifier(key)
      ? ts.factory.createIdentifier(key)
      : ts.factory.createStringLiteral(key),
    toExpression(value)
  );
}

function createValFileReference(value: FileSource) {
  const args: ts.Expression[] = [
    ts.factory.createStringLiteral(value[FILE_REF_PROP]),
  ];
  if (value.metadata) {
    args.push(toExpression(value.metadata));
  }

  return ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier("val"),
      ts.factory.createIdentifier("file")
    ),
    undefined,
    args
  );
}

function createValLink(value: LinkSource) {
  const args: ts.Expression[] = [ts.factory.createStringLiteral(value.href)];

  return ts.factory.createCallExpression(
    ts.factory.createPropertyAccessExpression(
      ts.factory.createIdentifier("val"),
      ts.factory.createIdentifier("link")
    ),
    undefined,
    args
  );
}

function createValRichTextTaggedStringTemplate(
  value: RichTextSource<AnyRichTextOptions>
): ts.Expression {
  const [[head, ...others], nodes] =
    Internal.richTextToTaggedStringTemplate(value);
  const tag = ts.factory.createPropertyAccessExpression(
    ts.factory.createIdentifier("val"),
    ts.factory.createIdentifier("richtext")
  );
  if (nodes.length > 0) {
    return ts.factory.createTaggedTemplateExpression(
      tag,
      undefined,
      ts.factory.createTemplateExpression(
        ts.factory.createTemplateHead(head, head),
        others.map((s, i) =>
          ts.factory.createTemplateSpan(
            toExpression(nodes[i]),
            i < others.length - 1
              ? ts.factory.createTemplateMiddle(s, s)
              : ts.factory.createTemplateTail(s, s)
          )
        )
      )
    );
  }
  return ts.factory.createTaggedTemplateExpression(
    tag,
    undefined,
    ts.factory.createNoSubstitutionTemplateLiteral(head, head)
  );
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
    if (isValFileValue(value)) {
      return createValFileReference(value);
    } else if (isValLinkValue(value)) {
      return createValLink(value);
    } else if (isValRichTextValue(value)) {
      return createValRichTextTaggedStringTemplate(value);
    }
    return ts.factory.createObjectLiteralExpression(
      Object.entries(value).map(([key, value]) =>
        createPropertyAssignment(key, value)
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
      if (index > nodes.length) {
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
      if (index >= nodes.length) {
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
  } else if (isValFileMethodCall(node)) {
    if (key === FILE_REF_PROP) {
      if (typeof value !== "string") {
        return result.err(
          new PatchError(
            "Cannot replace val.file reference with non-string value"
          )
        );
      }
      return pipe(
        findValFileNodeArg(node),
        result.map((refNode) => replaceNodeValue(document, refNode, value))
      );
    } else {
      return pipe(
        findValFileMetadataArg(node),
        result.flatMap((metadataArgNode) => {
          if (!metadataArgNode) {
            return result.err(
              new PatchError(
                "Cannot replace in val.file metadata when it does not exist"
              )
            );
          }
          if (key !== "metadata") {
            return result.err(
              new PatchError(
                `Cannot replace val.file metadata key ${key} when it does not exist`
              )
            );
          }
          return replaceInNode(
            document,
            // TODO: creating a fake object here might not be right - seems to work though
            ts.factory.createObjectLiteralExpression([
              ts.factory.createPropertyAssignment(key, metadataArgNode),
            ]),
            key,
            value
          );
        })
      );
    }
  } else {
    return result.err(
      shallowValidateExpression(node) ??
        new PatchError("Cannot replace in non-object/array")
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
  } else if (isValFileMethodCall(node)) {
    if (key === FILE_REF_PROP) {
      return findValFileNodeArg(node);
    }
    return findValFileMetadataArg(node);
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
  path: array.NonEmptyArray<string>
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
  return pipe(
    path,
    result.flatMapReduce(
      (node: ts.Expression, key: string) =>
        pipe(
          getFromNode(node, key),
          result.filterOrElse(
            (
              childNode: ts.Expression | undefined
            ): childNode is ts.Expression => childNode !== undefined,
            (): PatchError | ValSyntaxErrorTree =>
              new PatchError("Path refers to non-existing object/array")
          )
        ),
      rootNode
    )
  );
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
  } else if (isValFileMethodCall(node)) {
    if (key === FILE_REF_PROP) {
      return result.err(new PatchError("Cannot remove a ref from val.file"));
    } else {
      return pipe(
        findValFileMetadataArg(node),
        result.flatMap((metadataArgNode) => {
          if (!metadataArgNode) {
            return result.err(
              new PatchError(
                "Cannot remove from val.file metadata when it does not exist"
              )
            );
          }
          return removeFromNode(document, metadataArgNode, key);
        })
      );
    }
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
  path: array.NonEmptyArray<string>
): TSOpsResult<[document: ts.SourceFile, removed: ts.Expression]> {
  return pipe(
    getPointerFromPath(rootNode, path),
    result.flatMap(([node, key]: Pointer) =>
      removeFromNode(document, node, key)
    )
  );
}

export function isValFileValue(value: JSONValue): value is FileSource<{
  [key: string]: JsonPrimitive;
}> {
  return !!(
    typeof value === "object" &&
    value &&
    // TODO: replace the below with this:
    // VAL_EXTENSION in value &&
    // value[VAL_EXTENSION] === "file" &&
    FILE_REF_PROP in value &&
    typeof value[FILE_REF_PROP] === "string"
  );
}
function isValLinkValue(value: JSONValue): value is LinkSource {
  return !!(
    typeof value === "object" &&
    value &&
    VAL_EXTENSION in value &&
    value[VAL_EXTENSION] === "link"
  );
}

function isValRichTextValue(
  value: JSONValue
): value is RichTextSource<AnyRichTextOptions> {
  return !!(
    typeof value === "object" &&
    value &&
    VAL_EXTENSION in value &&
    value[VAL_EXTENSION] === "richtext" &&
    "children" in value &&
    typeof value.children === "object" &&
    Array.isArray(value.children)
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
    if (key === FILE_REF_PROP) {
      return result.err(new PatchError("Cannot add a key ref to object"));
    }
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
                createPropertyAssignment(key, value)
              ),
            ];
          } else {
            return replaceNodeValue(document, assignment.initializer, value);
          }
        }
      )
    );
  } else if (isValFileMethodCall(node)) {
    if (key === FILE_REF_PROP) {
      if (typeof value !== "string") {
        return result.err(
          new PatchError(
            `Cannot add ${FILE_REF_PROP} key to val.file with non-string value`
          )
        );
      }
      return pipe(
        findValFileNodeArg(node),
        result.map((arg: ts.Expression) =>
          replaceNodeValue(document, arg, value)
        )
      );
    } else {
      return pipe(
        findValFileMetadataArg(node),
        result.flatMap((metadataArgNode) => {
          if (metadataArgNode) {
            return result.err(
              new PatchError(
                "Cannot add metadata to val.file when it already exists"
              )
            );
          }
          if (key !== "metadata") {
            return result.err(
              new PatchError(
                `Cannot add ${key} key to val.file: only metadata is allowed`
              )
            );
          }
          return result.ok([
            insertAt(
              document,
              node.arguments,
              node.arguments.length,
              toExpression(value)
            ),
          ]);
        })
      );
    }
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
>([document]: T) {
  return document;
}

export class TSOps implements Ops<ts.SourceFile, ValSyntaxErrorTree> {
  constructor(
    private findRoot: (
      document: ts.SourceFile
    ) => result.Result<ts.Expression, ValSyntaxErrorTree>
  ) {}
  get(document: ts.SourceFile, path: string[]): TSOpsResult<JSONValue> {
    return pipe(
      document,
      this.findRoot,
      result.flatMap((rootNode: ts.Expression) => getAtPath(rootNode, path)),
      result.flatMap(evaluateExpression)
    );
  }
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
  remove(
    document: ts.SourceFile,
    path: array.NonEmptyArray<string>
  ): TSOpsResult<ts.SourceFile> {
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
    from: array.NonEmptyArray<string>,
    path: string[]
  ): TSOpsResult<ts.SourceFile> {
    return pipe(
      document,
      this.findRoot,
      result.flatMap((rootNode: ts.Expression) =>
        removeAtPath(document, rootNode, from)
      ),
      result.flatMap(
        ([document, removedNode]: [
          doc: ts.SourceFile,
          removedNode: ts.Expression
        ]) =>
          pipe(
            evaluateExpression(removedNode),
            result.map(
              (
                removedValue: JSONValue
              ): [doc: ts.SourceFile, removedValue: JSONValue] => [
                document,
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
