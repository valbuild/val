import { ClassDeclaration, MethodDeclaration, Project } from "ts-morph";
import ts from "typescript";
import path from "path";
import { ValidTypes } from "@valbuild/lib";
import { ValModuleResolver } from "./ValModuleResolver";

const getFixedMethodDecl = (
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

  const fixedMethodsDecls = schemaDecls
    .filter((schemaDeclaration): schemaDeclaration is ClassDeclaration =>
      schemaDeclaration.isKind(ts.SyntaxKind.ClassDeclaration)
    )
    .map((decl) => decl.getMethod("fixed"))
    .filter((method): method is MethodDeclaration => !!method);
  if (fixedMethodsDecls.length === 0) {
    throw Error(
      `Unable to resolve Schema["fixed"] from "@valbuild/lib": Method not found`
    );
  }
  if (fixedMethodsDecls.length > 1) {
    throw Error(
      `Unable to resolve Schema["fixed"] from "@valbuild/lib": Method is ambiguous`
    );
  }
  return fixedMethodsDecls[0];
};

export const writeValFile = async (
  id: string,
  valConfigPath: string,
  updatedVal: ValidTypes,
  resolver: ValModuleResolver
): Promise<void> => {
  const project = new Project({
    tsConfigFilePath: path.join(resolver.projectRoot, "tsconfig.json"),
  });
  const typeChecker = project.getTypeChecker();

  const filePath = resolver.resolveSourceModulePath(
    valConfigPath,
    `.${id}.val`
  );
  const valfixedMethod = getFixedMethodDecl(project, filePath);

  const sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) {
    throw Error(`No file found at ${filePath}`);
  }

  const fixedReferencesInModule = valfixedMethod
    .findReferencesAsNodes()
    .filter((reference) => reference.getSourceFile() === sourceFile);
  if (fixedReferencesInModule.length === 0) {
    throw Error(`No reference to Schema["fixed"] in ${id}.val.ts found`);
  }
  if (fixedReferencesInModule.length > 1) {
    throw Error(`Multiple references to Schema["fixed"] in ${id}.val.ts found`);
  }
  const [fixedReference] = fixedReferencesInModule;

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

  const expectedId = `"${id}"`;
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

  if (functionBodyExpr.getNameNode() !== fixedReference) {
    throw Error(`Function body expression is not a fixed call`);
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
