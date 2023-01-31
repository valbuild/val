import ts from "typescript";
import { ValModuleResolver } from "./ValModuleResolver";
import { analyzeValModule } from "./static/valModule";
import { applyPatch, Operation } from "./static/patch";

export const patchValFile = async (
  id: string,
  valConfigPath: string,
  patch: Operation[],
  resolver: ValModuleResolver
): Promise<void> => {
  const filePath = resolver.resolveSourceModulePath(
    valConfigPath,
    `.${id}.val`
  );

  const sourceFile = resolver.compilerHost.getSourceFile(
    filePath,
    ts.ScriptTarget.ES2020
  );

  if (!sourceFile) {
    throw Error(`Source file ${filePath} not found`);
  }

  const { fixedContent } = analyzeValModule(sourceFile);

  const newSourceFile = applyPatch(sourceFile, fixedContent, patch);
  resolver.compilerHost.writeFile(
    newSourceFile.fileName,
    newSourceFile.text,
    false,
    undefined,
    [newSourceFile]
  );
};
