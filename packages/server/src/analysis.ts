import { ValidTypes } from "@valbuild/lib";
import ts from "typescript";
import * as result from "./result";

export type ValModuleAnalysis = {
  schema: ts.Node;
  fixedContent: ts.Node;
};

class ValSyntaxError extends Error {
  constructor(message: string, public node: ts.Node) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

type ValSyntaxErrorTree = ValSyntaxError | ValSyntaxErrorTree[];

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

function flattenErrors(tree: ValSyntaxErrorTree): ValSyntaxError[] {
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

/* function composeSyntaxErrors(message: string, node: ts.Node) {
  return result.mapErr(
    (errors: ValSyntaxError[]) =>
      new CompositeValSyntaxError(message, node, errors)
  );
} */

function getObjectLiteralEntries(
  value: ts.ObjectLiteralExpression
): result.Result<[key: string, value: ts.Expression][], ValSyntaxErrorTree> {
  return result.all(
    value.properties.map((assignment) => {
      if (!ts.isPropertyAssignment(assignment)) {
        return result.err(
          new ValSyntaxError(
            "Object entry is not a property assignment",
            assignment
          )
        );
      }
      const key = evaluatePropertyName(assignment.name);
      return result.map<string, [key: string, value: ts.Expression]>(
        (key: string) => [key, assignment.initializer]
      )(key);
    })
  );
}

export function evaluateExpression(
  value: ts.Node
): result.Result<ValidTypes, ValSyntaxErrorTree> {
  if (ts.isStringLiteralLike(value)) {
    return result.ok(value.text);
  } else if (ts.isArrayLiteralExpression(value)) {
    return result.all(value.elements.map(evaluateExpression));
  } else if (ts.isObjectLiteralExpression(value)) {
    return result.flatMap((entries: [key: string, value: ts.Expression][]) =>
      result.map(Object.fromEntries)(
        result.all<[key: string, value: ValidTypes][], ValSyntaxErrorTree>(
          entries.map(([key, valueNode]) =>
            result.map<ValidTypes, [key: string, value: ValidTypes]>(
              (value) => [key, value]
            )(evaluateExpression(valueNode))
          )
        )
      )
    )(getObjectLiteralEntries(value));
  } else {
    return result.err(
      new ValSyntaxError("Value must be a string/integer/array literal", value)
    );
  }
}

export function find(
  value: ts.Node,
  key: string
): result.Result<ts.Node | undefined, ValSyntaxErrorTree> {
  if (ts.isObjectLiteralExpression(value)) {
    return result.flatMap((entries: [key: string, value: ts.Node][]) => {
      const matchingEntries = entries.filter(([entryKey]) => entryKey === key);
      if (matchingEntries.length === 0) return result.ok(undefined);
      if (matchingEntries.length === 1) {
        const [[, value]] = matchingEntries;
        return result.ok(value);
      }
      return result.err(
        new ValSyntaxError(`Object key "${key}" is ambiguous`, value)
      );
    })(getObjectLiteralEntries(value));
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

function analyseContentExpression(node: ts.Node) {
  if (!ts.isCallExpression(node)) {
    throw Error(
      `Expected body of val.content callback to be a call expression, got: ${
        ts.SyntaxKind[node.kind]
      }`
    );
  }

  // Validate that .fixed is called on a Schema
  const schemaFixed = node.expression;
  if (!ts.isPropertyAccessExpression(schemaFixed)) {
    throw Error(
      `Expected val.content to call Schema.fixed, got: ${
        ts.SyntaxKind[node.kind]
      }`
    );
  }
  const fixed = schemaFixed.name;
  if (!ts.isIdentifier(fixed) || fixed.text !== "fixed") {
    throw Error(
      `Expected val.content to call fixed on Schema, got: ${fixed.text}`
    );
  }
  const schema = schemaFixed.expression;

  if (node.arguments.length !== 1) {
    throw Error(
      `Expected Schema.fixed call to have a single argument, got: ${node.arguments.length}`
    );
  }
  const [fixedContent] = node.arguments;
  return {
    schema,
    fixedContent,
  };
}

function analyseDefaultExport(
  node: ts.ExportAssignment,
  sourceFile: ts.SourceFile
): ValModuleAnalysis {
  const valContentCall = node.expression;
  if (!ts.isCallExpression(valContentCall)) {
    throw Error(
      `Expected default expression to be a call expression, got: ${
        ts.SyntaxKind[node.kind]
      }`
    );
  }

  {
    // Assert that call expression calls val.content
    const valContent = valContentCall.expression;
    if (!ts.isPropertyAccessExpression(valContent)) {
      throw Error(
        `Expected default expression to be calling val.content, got: ${valContent.getText(
          sourceFile
        )}`
      );
    }
    {
      const val = valContent.expression;
      const content = valContent.name;
      if (!ts.isIdentifier(val) || val.text !== "val") {
        throw Error(
          `Expected default expression to be calling val.content, got: ${valContent.getText(
            sourceFile
          )}`
        );
      }
      if (!ts.isIdentifier(content) || content.text !== "content") {
        throw Error(
          `Expected default expression to be calling val.content, got: ${valContent.getText(
            sourceFile
          )}`
        );
      }
    }
  }

  if (valContentCall.arguments.length !== 2) {
    throw Error(
      `Expected val.content call to have 2 arguments, got: ${valContentCall.arguments.length}`
    );
  }
  const [id, callback] = valContentCall.arguments;
  // TODO: validate ID value here?
  if (!ts.isStringLiteral(id)) {
    throw Error(
      `Expected first argument to val.content to be a string literal, got: ${
        ts.SyntaxKind[id.kind]
      }`
    );
  }

  if (!ts.isArrowFunction(callback)) {
    throw Error(
      `Expected second argument to val.content to be an arrow function, got: ${
        ts.SyntaxKind[id.kind]
      }`
    );
  }

  return analyseContentExpression(callback.body);
}

export function analyseValModule(sourceFile: ts.SourceFile): ValModuleAnalysis {
  const analysis = sourceFile.forEachChild((node) => {
    if (ts.isExportAssignment(node)) {
      return analyseDefaultExport(node, sourceFile);
    }
  });

  if (!analysis) {
    throw Error("Failed to find fixed content node in val module");
  }

  return analysis;
}
