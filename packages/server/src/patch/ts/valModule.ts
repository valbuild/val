import ts from "typescript";
import { result, pipe } from "@valbuild/core/fp";
import { ValSyntaxError, ValSyntaxErrorTree } from "./syntax";

export type ValModuleAnalysis = {
  schema: ts.Expression;
  source: ts.Expression;
};

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
  const cDefine = node.expression;
  if (!ts.isCallExpression(cDefine)) {
    return result.err(
      new ValSyntaxError(
        "Expected default expression to be a call expression",
        cDefine
      )
    );
  }

  if (!isPath(cDefine.expression, ["c", "define"])) {
    return result.err(
      new ValSyntaxError(
        "Expected default expression to be calling c.define",
        cDefine.expression
      )
    );
  }

  return pipe(
    validateArguments(cDefine, [
      (id: ts.Node) => {
        // TODO: validate ID value here?
        if (!ts.isStringLiteralLike(id)) {
          return result.err(
            new ValSyntaxError(
              "Expected first argument to c.define to be a string literal",
              id
            )
          );
        }
        return result.voidOk;
      },
      () => {
        return result.voidOk;
      },
      () => {
        return result.voidOk;
      },
    ]),
    result.map(() => {
      const [, schema, source] = cDefine.arguments;
      return { schema, source };
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
