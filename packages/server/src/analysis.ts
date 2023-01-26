import { ValidTypes } from "@valbuild/lib";
import ts from "typescript";

export type ValModuleAnalysis = {
  schema: ts.Node;
  fixedContent: ts.Node;
};

function evaluatePropertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name)) {
    return name.text;
  } else if (ts.isStringLiteral(name)) {
    return name.text;
  } else if (ts.isNumericLiteral(name)) {
    // TODO: This is a terrible idea, isn't it?
    return (eval(name.text) as number).toString();
  } else if (ts.isComputedPropertyName(name)) {
    throw Error("Computed property names are not supported");
  } else if (ts.isPrivateIdentifier(name)) {
    throw Error("Private identifiers are not supported");
  } else {
    throw Error("Invalid property name");
  }
}

export function evaluateExpression(value: ts.Node): ValidTypes {
  if (ts.isStringLiteralLike(value)) {
    return value.text;
  } else if (ts.isArrayLiteralExpression(value)) {
    return value.elements.map(evaluateExpression);
  } else if (ts.isObjectLiteralExpression(value)) {
    return Object.fromEntries(
      value.properties.map((assignment) => {
        if (!ts.isPropertyAssignment(assignment)) {
          throw Error("Object entry is not a property assignment");
        }
        const key = evaluatePropertyName(assignment.name);
        const value = evaluateExpression(assignment.initializer);
        return [key, value];
      })
    );
  } else {
    throw Error("Value must be a string/integer/object/array literal");
  }
}

export function find(value: ts.Node, key: string): ts.Node | undefined {
  if (ts.isObjectLiteralExpression(value)) {
    // Assuming in the case of duplicate keys the last value should be used.
    const assignment = [...value.properties]
      .reverse()
      .find((assignment): assignment is ts.PropertyAssignment => {
        if (!ts.isPropertyAssignment(assignment)) {
          throw Error("Object entry is not a property assignment");
        }
        return evaluatePropertyName(assignment.name) === key;
      });

    return assignment?.initializer;
  } else if (ts.isArrayLiteralExpression(value)) {
    const keyNum = parseInt(key);
    // TODO: This is inaccurate in case elements are spreads
    return value.elements[keyNum];
  } else {
    throw Error("Value is not an object or an array");
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
