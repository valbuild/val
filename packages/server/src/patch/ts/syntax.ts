import ts from "typescript";
import { result, pipe } from "@valbuild/lib/fp";
import { JSONValue } from "@valbuild/lib/patch";

export class ValSyntaxError {
  constructor(public message: string, public node: ts.Node) {}
}

export type ValSyntaxErrorTree =
  | ValSyntaxError
  | [ValSyntaxErrorTree, ...ValSyntaxErrorTree[]];

function forEachError(
  tree: ValSyntaxErrorTree,
  callback: (error: ValSyntaxError) => void
) {
  if (Array.isArray(tree)) {
    for (const subtree of tree) {
      forEachError(subtree, callback);
    }
  } else {
    callback(tree);
  }
}

export function flattenErrors(
  tree: ValSyntaxErrorTree
): [ValSyntaxError, ...ValSyntaxError[]] {
  const result: ValSyntaxError[] = [];
  forEachError(tree, result.push.bind(result));
  return result as [ValSyntaxError, ...ValSyntaxError[]];
}

export function flatMapErrors<T>(
  tree: ValSyntaxErrorTree,
  cb: (error: ValSyntaxError) => T
): [T, ...T[]] {
  const result: T[] = [];
  forEachError(tree, (error) => result.push(cb(error)));
  return result as [T, ...T[]];
}

export function formatSyntaxError(
  error: ValSyntaxError,
  sourceFile: ts.SourceFile
): string {
  const pos = sourceFile.getLineAndCharacterOfPosition(error.node.pos);
  return `${pos.line}:${pos.character} ${error.message}`;
}

export function formatSyntaxErrorTree(
  tree: ValSyntaxErrorTree,
  sourceFile: ts.SourceFile
): string[] {
  return flatMapErrors(tree, (error) => formatSyntaxError(error, sourceFile));
}

type LiteralPropertyName = (
  | ts.Identifier
  | ts.StringLiteral
  | ts.NumericLiteral
) & {
  /**
   * The text property of a LiteralExpression stores the interpreted value of the literal in text form. For a StringLiteral,
   * or any literal of a template, this means quotes have been removed and escapes have been converted to actual characters.
   * For a NumericLiteral, the stored value is the toString() representation of the number. For example 1, 1.00, and 1e0 are all stored as just "1".
   * https://github.com/microsoft/TypeScript/blob/4b794fe1dd0d184d3f8f17e94d8187eace57c91e/src/compiler/types.ts#L2127-L2131
   */
  name: string;
};

function isLiteralPropertyName(
  name: ts.PropertyName
): name is LiteralPropertyName {
  return (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  );
}

type LiteralPropertyAssignment = ts.PropertyAssignment & {
  name: LiteralPropertyName;
};

function validateObjectProperties<
  T extends readonly ts.ObjectLiteralElementLike[]
>(
  nodes: T
): result.Result<T & readonly LiteralPropertyAssignment[], ValSyntaxErrorTree> {
  const errors: ValSyntaxError[] = [];
  for (const node of nodes) {
    if (!ts.isPropertyAssignment(node)) {
      errors.push(
        new ValSyntaxError(
          "Object literal element must be property assignment",
          node
        )
      );
    } else if (!isLiteralPropertyName(node.name)) {
      errors.push(
        new ValSyntaxError(
          "Object literal element key must be an identifier or a literal",
          node
        )
      );
    }
  }
  if (errors.length > 0) {
    return result.err(errors as ValSyntaxErrorTree);
  }
  return result.ok(nodes as T & LiteralPropertyAssignment[]);
}

/**
 * Validates that the expression is a JSON compatible type of expression without
 * validating its children.
 */
export function shallowValidateExpression(
  value: ts.Expression
): ValSyntaxError | undefined {
  return ts.isStringLiteralLike(value) ||
    ts.isNumericLiteral(value) ||
    value.kind === ts.SyntaxKind.TrueKeyword ||
    value.kind === ts.SyntaxKind.FalseKeyword ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    ts.isArrayLiteralExpression(value) ||
    ts.isObjectLiteralExpression(value)
    ? undefined
    : new ValSyntaxError("Value must be a literal", value);
}

/**
 * Validates that the expression is JSON compatible.
 */
export function deepValidateExpression(
  value: ts.Expression
): result.Result<void, ValSyntaxErrorTree> {
  if (ts.isStringLiteralLike(value)) {
    return result.voidOk;
  } else if (ts.isNumericLiteral(value)) {
    return result.voidOk;
  } else if (value.kind === ts.SyntaxKind.TrueKeyword) {
    return result.voidOk;
  } else if (value.kind === ts.SyntaxKind.FalseKeyword) {
    return result.voidOk;
  } else if (value.kind === ts.SyntaxKind.NullKeyword) {
    return result.voidOk;
  } else if (ts.isArrayLiteralExpression(value)) {
    return result.allV(value.elements.map(deepValidateExpression));
  } else if (ts.isObjectLiteralExpression(value)) {
    return pipe(
      validateObjectProperties(value.properties),
      result.flatMap((assignments: ts.NodeArray<LiteralPropertyAssignment>) =>
        pipe(
          assignments.map((assignment) =>
            deepValidateExpression(assignment.initializer)
          ),
          result.allV
        )
      )
    );
  } else {
    return result.err(new ValSyntaxError("Value must be a literal", value));
  }
}

export const FileSrcRef = "ref";

/**
 * Evaluates the expression as a JSON value
 */
export function evaluateExpression(
  value: ts.Expression
): result.Result<JSONValue, ValSyntaxErrorTree> {
  // The text property of a LiteralExpression stores the interpreted value of the literal in text form. For a StringLiteral,
  // or any literal of a template, this means quotes have been removed and escapes have been converted to actual characters.
  // For a NumericLiteral, the stored value is the toString() representation of the number. For example 1, 1.00, and 1e0 are all stored as just "1".
  // https://github.com/microsoft/TypeScript/blob/4b794fe1dd0d184d3f8f17e94d8187eace57c91e/src/compiler/types.ts#L2127-L2131

  if (ts.isStringLiteralLike(value)) {
    return result.ok(value.text);
  } else if (ts.isNumericLiteral(value)) {
    return result.ok(Number(value.text));
  } else if (value.kind === ts.SyntaxKind.TrueKeyword) {
    return result.ok(true);
  } else if (value.kind === ts.SyntaxKind.FalseKeyword) {
    return result.ok(false);
  } else if (value.kind === ts.SyntaxKind.NullKeyword) {
    return result.ok(null);
  } else if (ts.isArrayLiteralExpression(value)) {
    return result.all(value.elements.map(evaluateExpression));
  } else if (ts.isObjectLiteralExpression(value)) {
    return pipe(
      validateObjectProperties(value.properties),
      result.flatMap((assignments: ts.NodeArray<LiteralPropertyAssignment>) =>
        pipe(
          assignments.map((assignment) =>
            pipe(
              evaluateExpression(assignment.initializer),
              result.map<JSONValue, [key: string, value: JSONValue]>(
                (value) => [assignment.name.text, value]
              )
            )
          ),
          result.all
        )
      ),
      result.map(Object.fromEntries)
    );
  } else {
    return result.err(new ValSyntaxError("Value must be a literal", value));
  }
}

export function findObjectPropertyAssignment(
  value: ts.ObjectLiteralExpression,
  key: string
): result.Result<LiteralPropertyAssignment | undefined, ValSyntaxErrorTree> {
  return pipe(
    validateObjectProperties(value.properties),
    result.flatMap((assignments: ts.NodeArray<LiteralPropertyAssignment>) => {
      const matchingAssignments = assignments.filter(
        (assignment) => assignment.name.text === key
      );
      if (matchingAssignments.length === 0) return result.ok(undefined);
      if (matchingAssignments.length > 1) {
        return result.err(
          new ValSyntaxError(`Object key "${key}" is ambiguous`, value)
        );
      }
      const [assignment] = matchingAssignments;
      return result.ok(assignment);
    })
  );
}

export function isValFileMethodCall(
  node: ts.Expression
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "val" &&
    node.expression.name.text === "file"
  );
}

/**
 * Given a list of expressions, validates that all the expressions are not
 * spread elements. In other words, it ensures that the expressions are the
 * initializers of the values at their respective indices in the evaluated list.
 */
export function validateInitializers(
  nodes: ReadonlyArray<ts.Expression>
): ValSyntaxErrorTree | undefined {
  for (const node of nodes) {
    if (ts.isSpreadElement(node)) {
      return new ValSyntaxError("Unexpected spread element", node);
    }
  }
  return undefined;
}
