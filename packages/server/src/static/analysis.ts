import ts from "typescript";
import { pipe } from "../fp";
import * as result from "../result";
import { StaticValue } from "./ops";

class ValSyntaxError extends Error {
  constructor(message: string, public node: ts.Node) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
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

function evaluatePropertyName(
  name: ts.PropertyName
): result.Result<string, ValSyntaxErrorTree> {
  if (ts.isIdentifier(name)) {
    return result.ok(name.text);
  } else if (ts.isStringLiteralLike(name)) {
    return result.ok(name.text);
  } else if (ts.isNumericLiteral(name)) {
    // For a NumericLiteral, the stored value is the toString() representation of the number. For example 1, 1.00, and 1e0 are all stored as just "1".
    // https://github.com/microsoft/TypeScript/blob/4b794fe1dd0d184d3f8f17e94d8187eace57c91e/src/compiler/types.ts#L2127-L2131
    return result.ok(name.text);
  } else {
    return result.err([
      new ValSyntaxError(
        `Invalid property name type: ${ts.SyntaxKind[name.kind]}`,
        name
      ),
    ]);
  }
}

function getObjectPropertyAssignments(
  value: ts.ObjectLiteralExpression
): result.Result<
  [key: string, assignment: ts.PropertyAssignment][],
  ValSyntaxErrorTree
> {
  return result.all(
    value.properties.map((assignment) => {
      if (!ts.isPropertyAssignment(assignment)) {
        return result.err(
          new ValSyntaxError(
            "Object literal element is not a property assignment",
            assignment
          )
        );
      }
      const key = evaluatePropertyName(assignment.name);
      return result.map<string, [key: string, value: ts.PropertyAssignment]>(
        (key: string) => [key, assignment]
      )(key);
    })
  );
}

/**
 * Validates that the expression is a valid type of expression, but does not
 * validate its children.
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

export function evaluateExpression(
  value: ts.Expression
): result.Result<StaticValue, ValSyntaxErrorTree> {
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
      getObjectPropertyAssignments(value),
      result.flatMap(
        (entries: [key: string, assignment: ts.PropertyAssignment][]) =>
          pipe(
            entries.map(([key, assignment]) =>
              pipe(
                evaluateExpression(assignment.initializer),
                result.map<StaticValue, [key: string, value: StaticValue]>(
                  (value) => [key, value]
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
): result.Result<ts.PropertyAssignment | undefined, ValSyntaxErrorTree> {
  return pipe(
    getObjectPropertyAssignments(value),
    result.flatMap(
      (entries: [key: string, assignment: ts.PropertyAssignment][]) => {
        const matchingEntries = entries.filter(
          ([entryKey]) => entryKey === key
        );
        if (matchingEntries.length === 0) return result.ok(undefined);
        if (matchingEntries.length === 1) {
          const [[, value]] = matchingEntries;
          return result.ok(value);
        }
        return result.err(
          new ValSyntaxError(`Object key "${key}" is ambiguous`, value)
        );
      }
    )
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
