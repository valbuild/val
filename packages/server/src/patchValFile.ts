import { analyzeValModule } from "./patch/ts/valModule";
import { applyPatch, Patch, PatchError } from "@valbuild/lib/patch";
import { TSOps } from "./patch/ts/ops";
import { result, pipe } from "@valbuild/lib/fp";
import { flatMapErrors, formatSyntaxError } from "./patch/ts/syntax";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import { SerializedVal } from "@valbuild/lib";
import { readValFile } from "./readValFile";
import { QuickJSRuntime } from "quickjs-emscripten";

export const patchValFile = async (
  id: string,
  valConfigPath: string,
  patch: Patch,
  sourceFileHandler: ValSourceFileHandler,
  runtime: QuickJSRuntime
): Promise<SerializedVal> => {
  const filePath = sourceFileHandler.resolveSourceModulePath(
    valConfigPath,
    `.${id}.val`
  );

  const sourceFile = sourceFileHandler.getSourceFile(filePath);

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

  sourceFileHandler.writeSourceFile(newSourceFile.value);

  return readValFile(id, valConfigPath, runtime);
};
