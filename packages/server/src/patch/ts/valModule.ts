import ts from "typescript";
import { pipe } from "../../fp/util";
import * as result from "../../fp/result";
import { ValSyntaxError, ValSyntaxErrorTree } from "./syntax";

export type ValModuleAnalysis = {
  schema: ts.Expression;
  fixedContent: ts.Expression;
};

function findContent(
  node: ts.Node
): result.Result<ValModuleAnalysis, ValSyntaxErrorTree> {
  if (!ts.isCallExpression(node)) {
    return result.err(
      new ValSyntaxError(
        "Expected body of val.content callback to be a call expression",
        node
      )
    );
  }

  // Validate that .fixed is called on a Schema
  const schemaFixed = node.expression;
  if (!ts.isPropertyAccessExpression(schemaFixed)) {
    return result.err(
      new ValSyntaxError("Expected val.content to call Schema.fixed", node)
    );
  }
  const fixed = schemaFixed.name;
  if (!ts.isIdentifier(fixed) || fixed.text !== "fixed") {
    return result.err(
      new ValSyntaxError("Expected val.content to call Schema.fixed", fixed)
    );
  }
  const schema = schemaFixed.expression;

  if (node.arguments.length !== 1) {
    return result.err(
      new ValSyntaxError(
        "Expected Schema.fixed call to have a single argument",
        node
      )
    );
  }
  const [fixedContent] = node.arguments;
  return result.ok({
    schema,
    fixedContent,
  });
}

function isPath(
  node: ts.Expression,
  path: readonly [string, ...string[]]
): boolean {
  let currentNode = node;
  for (let i = path.length - 1; i > 0; --i) {
    const name = path[i];
    if (!ts.isPropertyAccessExpression(currentNode)) {
      return false;
    }
    if (!ts.isIdentifier(currentNode.name) || currentNode.name.text !== name) {
      return false;
    }
    currentNode = currentNode.expression;
  }
  return ts.isIdentifier(currentNode) && currentNode.text === path[0];
}

function validateArguments(
  node: ts.CallExpression,
  validators: readonly ((
    node: ts.Expression
  ) => result.Result<void, ValSyntaxError>)[]
): result.Result<void, ValSyntaxErrorTree> {
  return result.allV<ValSyntaxError>([
    node.arguments.length === validators.length
      ? result.voidOk
      : result.err(
          new ValSyntaxError(`Expected ${validators.length} arguments`, node)
        ),
    ...node.arguments
      .slice(0, validators.length)
      .map((argument, index) => validators[index](argument)),
  ]);
}

function analyzeDefaultExport(
  node: ts.ExportAssignment
): result.Result<ValModuleAnalysis, ValSyntaxErrorTree> {
  const valContentCall = node.expression;
  if (!ts.isCallExpression(valContentCall)) {
    return result.err(
      new ValSyntaxError(
        "Expected default expression to be a call expression",
        valContentCall
      )
    );
  }

  if (!isPath(valContentCall.expression, ["val", "content"])) {
    return result.err(
      new ValSyntaxError(
        "Expected default expression to be calling val.content",
        valContentCall.expression
      )
    );
  }

  return pipe(
    validateArguments(valContentCall, [
      (id: ts.Node) => {
        // TODO: validate ID value here?
        if (!ts.isStringLiteralLike(id)) {
          return result.err(
            new ValSyntaxError(
              "Expected first argument to val.content to be a string literal",
              id
            )
          );
        }
        return result.voidOk;
      },
      (callback: ts.Node) => {
        if (!ts.isArrowFunction(callback)) {
          return result.err(
            new ValSyntaxError(
              "Expected second argument to val.content to be an arrow function",
              callback
            )
          );
        }
        return result.voidOk;
      },
    ]),
    result.flatMap(() => {
      const [, callback] = valContentCall.arguments;
      // as asserted above, callback must be an arrow function
      return findContent((callback as ts.ArrowFunction).body);
    })
  );
}

export function analyzeValModule(
  sourceFile: ts.SourceFile
): result.Result<ValModuleAnalysis, ValSyntaxErrorTree> {
  const analysis = sourceFile.forEachChild((node) => {
    if (ts.isExportAssignment(node)) {
      return analyzeDefaultExport(node);
    }
  });

  if (!analysis) {
    throw Error("Failed to find fixed content node in val module");
  }

  return analysis;
}
