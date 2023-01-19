import { ClassDeclaration, MethodDeclaration, Project } from "ts-morph";
import ts from "typescript";
import path from "path";
import { ValidTypes } from "@valbuild/lib";

const getStaticMethodDecl = (
  project: Project,
  valModulePath: string
): MethodDeclaration => {
  const resolutionResult = ts.resolveModuleName(
    "@valbuild/lib",
    valModulePath,
    project.compilerOptions.get(),
    project.getModuleResolutionHost()
  );
  const valLibModule = resolutionResult.resolvedModule;
  if (!valLibModule) {
    throw Error(`Unable to resolve "@valbuild/lib": Module not found`);
  }
  const valLibSourceFile = project.getSourceFile(valLibModule.resolvedFileName);
  if (!valLibSourceFile) {
    throw Error(`"@valbuild/lib" types not found: Type declarations not found`);
  }
  const schemaDecls = valLibSourceFile.getExportedDeclarations().get("Schema");
  if (!schemaDecls) {
    throw Error(
      `Unable to resolve Schema from "@valbuild/lib": Export declaration not found`
    );
  }

  const staticMethodsDecls = schemaDecls
    .filter((schemaDeclaration): schemaDeclaration is ClassDeclaration =>
      schemaDeclaration.isKind(ts.SyntaxKind.ClassDeclaration)
    )
    .map((decl) => decl.getMethod("static"))
    .filter((method): method is MethodDeclaration => !!method);
  if (staticMethodsDecls.length === 0) {
    throw Error(
      `Unable to resolve Schema["static"] from "@valbuild/lib": Method not found`
    );
  }
  if (staticMethodsDecls.length > 1) {
    throw Error(
      `Unable to resolve Schema["static"] from "@valbuild/lib": Method is ambiguous`
    );
  }
  return staticMethodsDecls[0];
};

export const writeValFile = async (
  rootDir: string,
  fileId: string,
  updatedVal: ValidTypes
): Promise<void> => {
  const project = new Project({
    tsConfigFilePath: path.join(rootDir, "tsconfig.json"),
  });
  const typeChecker = project.getTypeChecker();

  const filePath = path.join(rootDir, `${fileId}.val.ts`);
  const valStaticMethod = getStaticMethodDecl(project, filePath);

  const sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) {
    throw Error(`No file found at ${filePath}`);
  }

  const staticReferencesInModule = valStaticMethod
    .findReferencesAsNodes()
    .filter((reference) => reference.getSourceFile() === sourceFile);
  if (staticReferencesInModule.length === 0) {
    throw Error(`No reference to Schema["static"] in ${fileId}.val.ts found`);
  }
  if (staticReferencesInModule.length > 1) {
    throw Error(
      `Multiple references to Schema["static"] in ${fileId}.val.ts found`
    );
  }
  const [staticReference] = staticReferencesInModule;

  // typeChecker.getExportsOfModule(valConfigModuleSymbol).forEach((symbol) => {
  //   if (symbol.getName() === "s") {
  //     console.log(symbol);
  //   }
  // });

  const defaultExport = sourceFile.getExportAssignment((exportAssignment) => {
    return !exportAssignment.isExportEquals();
  });

  if (!defaultExport) {
    throw Error(`No default export found in ${filePath}`);
  }

  const exportExpression = defaultExport.getExpression();
  if (!exportExpression.isKind(ts.SyntaxKind.CallExpression)) {
    throw Error(`Export expression is not a call expression`);
  }

  const signature = typeChecker.getResolvedSignature(exportExpression);
  const maybeValContentType = signature?.getReturnType();

  if (!maybeValContentType) {
    throw Error(`Could not get return type of export expression`);
  }

  // const exportedTypeName = maybeValContentType.getSymbol()?.getName();
  // if (exportedTypeName !== "ValContent") {
  //   throw Error(`Exported type is not ValContent`);
  // }

  const defaultExportArgs = exportExpression.getArguments();

  if (defaultExportArgs.length !== 2) {
    throw Error(
      `Export expression does not have 2 arguments. Had: ${defaultExportArgs.length}}`
    );
  }
  const [maybeIdLiteral, maybeFunction] = defaultExportArgs;

  if (!maybeIdLiteral.isKind(ts.SyntaxKind.StringLiteral)) {
    throw Error(`First argument to export expression is not a string literal`);
  }

  if (!maybeFunction.isKind(ts.SyntaxKind.ArrowFunction)) {
    throw Error(
      `Second argument to export expression is not an arrow function`
    );
  }

  const expectedId = `"/${fileId}"`;
  if (maybeIdLiteral.getText() !== expectedId) {
    throw Error(
      `First argument to export expression is not the expected id. Expected: ${expectedId}. Actual: ${maybeIdLiteral.getText()}`
    );
  }

  const functionBody = maybeFunction.getBody();

  if (!functionBody.isKind(ts.SyntaxKind.CallExpression)) {
    throw Error(`Function body is not a call expression`);
  }

  const functionBodyExpr = functionBody.getExpression();
  if (!functionBodyExpr.isKind(ts.SyntaxKind.PropertyAccessExpression)) {
    throw Error(`Function body expression is not a property access expression`);
  }

  if (functionBodyExpr.getNameNode() !== staticReference) {
    throw Error(`Function body expression is not a static call`);
  }

  const functionBodyArgs = functionBody.getArguments();

  if (functionBodyArgs.length !== 1) {
    throw Error(
      `Function body does not have 1 argument. Had: ${functionBodyArgs.length}}`
    );
  }

  const [maybeValArg] = functionBodyArgs;

  maybeValArg.replaceWithText(JSON.stringify(updatedVal, null, 2));
  await project.save();
};
