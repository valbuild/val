import ts from "typescript";

export type ValModuleAnalysis = {
  schema: ts.Expression;
  fixedContent: ts.Expression;
};

function analyzeContentExpression(node: ts.Node) {
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

function analyzeDefaultExport(
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
  if (!ts.isStringLiteralLike(id)) {
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

  return analyzeContentExpression(callback.body);
}

export function analyzeValModule(sourceFile: ts.SourceFile): ValModuleAnalysis {
  const analysis = sourceFile.forEachChild((node) => {
    if (ts.isExportAssignment(node)) {
      return analyzeDefaultExport(node, sourceFile);
    }
  });

  if (!analysis) {
    throw Error("Failed to find fixed content node in val module");
  }

  return analysis;
}
