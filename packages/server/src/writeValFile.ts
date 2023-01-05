import {
  ImportDeclaration,
  MethodDeclaration,
  Program,
  Project,
} from "ts-morph";
import * as ts from "typescript";
import path from "path";

export const writeValFile = async (
  rootDir: string,
  fileId: string,
  updatedVal: unknown
): Promise<void> => {
  const project = new Project({
    tsConfigFilePath: path.join(rootDir, "tsconfig.json"),
  });
  const typeChecker = project.getTypeChecker();

  const filePath = path.join(rootDir, `${fileId}.val.ts`);

  const schemaModuleNames = [
    "@val/lib/src/schema/Schema",
    "@val/lib/dist/schema/Schema",
  ];
  const maybeResolution = ts.resolveModuleName(
    "@val/lib/src/schema/Schema",
    filePath,
    project.compilerOptions.get(),
    project.getModuleResolutionHost()
  );
  const valLibModule = maybeResolution.resolvedModule;
  if (!valLibModule) {
    throw Error(`Unable to resolve "@val/lib/src/schema/Schema"`);
  }

  const valLibSchemaSourceFile = project.getSourceFile(
    valLibModule.resolvedFileName
  );
  if (!valLibSchemaSourceFile) {
    throw Error(`"@val/lib/src/schema/Schema" types not found`);
  }
  console.log(valLibSchemaSourceFile);

  // if (!schemaExportDecl) {
  //   throw Error(`No export declaration found for Schema`);
  // }
  // const schemaExportSpecifier = schemaExportDecl
  //   .getNamedExports()
  //   .find((exportImport) => exportImport.getName() === "Schema");

  // if (!schemaExportSpecifier) {
  //   throw Error(`Could not find export specifier for Schema`);
  // }
  // const lsp = project.getLanguageService();

  // let valStaticMethod: MethodDeclaration | undefined = undefined;

  // for (const declaration of schemaExportSpecifier
  //   .getSymbol()
  //   ?.getDeclarations() || []) {
  //   for (const def of lsp.getDefinitions(declaration)) {
  //     // TODO: rewrite! Also check if this is actually class Schema
  //     valStaticMethod = def
  //       .getDeclarationNode()
  //       ?.asKindOrThrow(ts.SyntaxKind.ClassDeclaration)
  //       .getMethod("static");
  //   }
  // }

  // if (!valStaticMethod) {
  //   throw Error(`Could not find static method`);
  // }

  // const referencedSymbols = valStaticMethod.findReferences();

  // for (const referencedSymbol of referencedSymbols) {
  //   for (const reference of referencedSymbol.getReferences()) {
  //     const filePath = reference.getSourceFile().getFilePath();
  //     if (path.resolve(filePath) === path.join(rootDir, fileId + ".val.ts")) {
  //       // TODO: check id
  //       console.log(reference.getNode().getFullText());
  //     }
  //   }
  // }

  // typeChecker.getExportsOfModule(valConfigModuleSymbol).forEach((symbol) => {
  //   if (symbol.getName() === "s") {
  //     console.log(symbol);
  //   }
  // });

  // const sourceFile = project.getSourceFile(filePath);

  // if (!sourceFile) {
  //   throw Error(`No file found at ${filePath}`);
  // }

  // const defaultExport = sourceFile.getExportAssignment((exportAssignment) => {
  //   return !exportAssignment.isExportEquals();
  // });

  // if (!defaultExport) {
  //   throw Error(`No default export found in ${filePath}`);
  // }

  // const exportExpression = defaultExport.getExpression();
  // if (!exportExpression.isKind(ts.SyntaxKind.CallExpression)) {
  //   throw Error(`Export expression is not a call expression`);
  // }

  // const signature = typeChecker.getResolvedSignature(exportExpression);
  // const maybeValContentType = signature?.getReturnType();

  // if (!maybeValContentType) {
  //   throw Error(`Could not get return type of export expression`);
  // }

  // // const exportedTypeName = maybeValContentType.getSymbol()?.getName();
  // // if (exportedTypeName !== "ValContent") {
  // //   throw Error(`Exported type is not ValContent`);
  // // }

  // const defaultExportArgs = exportExpression.getArguments();

  // if (defaultExportArgs.length !== 2) {
  //   throw Error(
  //     `Export expression does not have 2 arguments. Had: ${defaultExportArgs.length}}`
  //   );
  // }
  // const [maybeIdLiteral, maybeFunction] = defaultExportArgs;

  // if (!maybeIdLiteral.isKind(ts.SyntaxKind.StringLiteral)) {
  //   throw Error(`First argument to export expression is not a string literal`);
  // }

  // if (!maybeFunction.isKind(ts.SyntaxKind.ArrowFunction)) {
  //   throw Error(
  //     `Second argument to export expression is not an arrow function`
  //   );
  // }

  // const expectedId = `"/${fileId}"`;
  // if (maybeIdLiteral.getText() !== expectedId) {
  //   throw Error(
  //     `First argument to export expression is not the expected id. Expected: ${expectedId}. Actual: ${maybeIdLiteral.getText()}`
  //   );
  // }

  // const functionBody = maybeFunction.getBody();

  // if (!functionBody.isKind(ts.SyntaxKind.CallExpression)) {
  //   throw Error(`Function body is not a call expression`);
  // }

  // const functionBodyExpr = functionBody.getExpression();
  // if (!functionBodyExpr.isKind(ts.SyntaxKind.PropertyAccessExpression)) {
  //   throw Error(`Function body expression is not a property access expression`);
  // }

  // const functionBodyExprName = functionBodyExpr.getName();

  // if (functionBodyExprName !== "static") {
  //   throw Error(`Function body expression is not a static call`);
  // }

  // const functionBodyArgs = functionBody.getArguments();

  // if (functionBodyArgs.length !== 1) {
  //   throw Error(
  //     `Function body does not have 1 argument. Had: ${functionBodyArgs.length}}`
  //   );
  // }

  // const [maybeValArg] = functionBodyArgs;

  // maybeValArg.replaceWithText(JSON.stringify(updatedVal, null, 2));
  // await project.save();
};
