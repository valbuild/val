import { ValModuleResolver } from "./ValModuleResolver";
import { analyzeValModule } from "./patch/ts/valModule";
import { applyPatch, Operation } from "./patch/patch";
import { TSOps } from "./patch/ts/ops";
import * as result from "./fp/result";
import { PatchError } from "./patch/ops";
import { flatMapErrors, formatSyntaxError } from "./patch/ts/syntax";
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

  const sourceFile = resolver.getSourceFile(filePath);

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
      throw new Error(
        `${filePath}\n${flatMapErrors(newSourceFile.error, (error) =>
          formatSyntaxError(error, sourceFile)
        ).join("\n")}`
      );
    }
  }

  resolver.writeSourceFile(newSourceFile.value);
};
