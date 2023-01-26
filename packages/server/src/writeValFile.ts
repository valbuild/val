import ts from "typescript";
import { ValidTypes } from "@valbuild/lib";
import { ValModuleResolver } from "./ValModuleResolver";
import { analyseValModule } from "./analysis";

export const writeValFile = async (
  id: string,
  valConfigPath: string,
  updatedVal: ValidTypes,
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

  const { fixedContent } = analyseValModule(sourceFile);

  const newFixedContentJSON = JSON.stringify(updatedVal, null, 2);
  const start = fixedContent.getStart(sourceFile, false);
  const end = fixedContent.end;
  const newText = `${sourceFile.text.substring(
    0,
    start
  )}${newFixedContentJSON}${sourceFile.text.substring(end)}`;

  const newSourceFile = sourceFile.update(newText, {
    span: {
      start,
      length: end - start,
    },
    newLength: newFixedContentJSON.length,
  });
  resolver.compilerHost.writeFile(
    newSourceFile.fileName,
    newSourceFile.text,
    false,
    undefined,
    [newSourceFile]
  );
};
