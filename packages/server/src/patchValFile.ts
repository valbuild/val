import ts from "typescript";
import { ValModuleResolver } from "./ValModuleResolver";
import { analyzeValModule } from "./static/valModule";
import { applyPatch, Operation } from "./static/patch";
import { TSOps } from "./static/typescript";
import * as result from "./fp/result";
import { PatchError } from "./static/ops";
import { flattenErrors } from "./static/analysis";
import { pipe } from "./fp/util";

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

  const ops = new TSOps((document) => {
    return pipe(
      analyzeValModule(document),
      result.map(({ fixedContent }) => fixedContent)
    );
  });
  const newSourceFile = applyPatch(sourceFile, ops, patch);
  if (result.isErr(newSourceFile)) {
    if (newSourceFile.error instanceof PatchError) {
      throw newSourceFile.error;
    } else {
      const errors = flattenErrors(newSourceFile.error);
      throw new Error(`Syntax error:\n${errors.join("\n")}`);
    }
  }

  resolver.compilerHost.writeFile(
    newSourceFile.value.fileName,
    newSourceFile.value.text,
    false,
    undefined,
    [newSourceFile.value]
  );
};
