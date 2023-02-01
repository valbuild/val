import ts from "typescript";
import * as result from "../result";
import { StaticValue } from "./ops";

class ValSyntaxError extends Error {
  constructor(message: string, public node: ts.Node) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export type ValSyntaxErrorTree = ValSyntaxError | ValSyntaxErrorTree[];

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

export function flattenErrors(tree: ValSyntaxErrorTree): ValSyntaxError[] {
  const result: ValSyntaxError[] = [];
  forEachError(tree, result.push.bind(result));
  return result;
}

function evaluatePropertyName(
  name: ts.PropertyName
): result.Result<string, ValSyntaxErrorTree> {
  if (ts.isIdentifier(name)) {
    return result.ok(name.text);
  } else if (ts.isStringLiteral(name)) {
    return result.ok(name.text);
  } else if (ts.isNumericLiteral(name)) {
    // TODO: This is a terrible idea, isn't it?
    return result.ok((eval(name.text) as number).toString());
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

export function evaluateExpression(
  value: ts.Node
): result.Result<StaticValue, ValSyntaxErrorTree> {
  if (ts.isStringLiteralLike(value)) {
    return result.ok(value.text);
  } else if (ts.isNumericLiteral(value)) {
    // TODO: This is a terrible idea, isn't it?
    return result.ok(eval(value.text) as number);
  } else if (value.kind === ts.SyntaxKind.TrueKeyword) {
    return result.ok(true);
  } else if (value.kind === ts.SyntaxKind.FalseKeyword) {
    return result.ok(false);
  } else if (value.kind === ts.SyntaxKind.NullKeyword) {
    return result.ok(null);
  } else if (ts.isArrayLiteralExpression(value)) {
    return result.all(value.elements.map(evaluateExpression));
  } else if (ts.isObjectLiteralExpression(value)) {
    return result.flatMap(
      (entries: [key: string, assignment: ts.PropertyAssignment][]) =>
        result.map(Object.fromEntries)(
          result.all<[key: string, value: StaticValue][], ValSyntaxErrorTree>(
            entries.map(([key, assignment]) =>
              result.map<StaticValue, [key: string, value: StaticValue]>(
                (value) => [key, value]
              )(evaluateExpression(assignment.initializer))
            )
          )
        )
    )(getObjectPropertyAssignments(value));
  } else {
    return result.err(
      new ValSyntaxError("Value must be a string/integer/array literal", value)
    );
  }
}

export function findObjectPropertyAssignment(
  value: ts.ObjectLiteralExpression,
  key: string
): result.Result<ts.PropertyAssignment | undefined, ValSyntaxErrorTree> {
  return result.flatMap(
    (entries: [key: string, assignment: ts.PropertyAssignment][]) => {
      const matchingEntries = entries.filter(([entryKey]) => entryKey === key);
      if (matchingEntries.length === 0) return result.ok(undefined);
      if (matchingEntries.length === 1) {
        const [[, value]] = matchingEntries;
        return result.ok(value);
      }
      return result.err(
        new ValSyntaxError(`Object key "${key}" is ambiguous`, value)
      );
    }
  )(getObjectPropertyAssignments(value));
}

export function find(
  value: ts.Node,
  key: string
): result.Result<ts.Expression | undefined, ValSyntaxErrorTree> {
  if (ts.isObjectLiteralExpression(value)) {
    return result.map(
      (assignment: ts.PropertyAssignment | undefined) => assignment?.initializer
    )(findObjectPropertyAssignment(value, key));
  } else if (ts.isArrayLiteralExpression(value)) {
    const keyNum = parseInt(key);
    // TODO: This is inaccurate in case elements are spreads
    return result.ok(value.elements[keyNum]);
  } else {
    return result.err(
      new ValSyntaxError("Value is not an object or an array literal", value)
    );
  }
}
