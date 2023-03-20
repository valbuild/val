import { analyzeValModule } from "./patch/ts/valModule";
import { applyPatch, Patch, PatchError } from "@valbuild/lib/patch";
import { TSOps } from "./patch/ts/ops";
import { result, pipe } from "@valbuild/lib/fp";
import {
  flatMapErrors,
  formatSyntaxError,
  type ValSyntaxErrorTree,
} from "./patch/ts/syntax";
import { ValSourceFileHandler } from "./ValSourceFileHandler";
import { SerializedModuleContent } from "@valbuild/lib";
import { readValFile } from "./readValFile";
import { QuickJSRuntime } from "quickjs-emscripten";
import ts from "typescript";

export const patchValFile = async (
  id: string,
  valConfigPath: string,
  patch: Patch,
  sourceFileHandler: ValSourceFileHandler,
  runtime: QuickJSRuntime
): Promise<SerializedModuleContent> => {
  const filePath = sourceFileHandler.resolveSourceModulePath(
    valConfigPath,
    `.${id}.val`
  );

  const sourceFile = sourceFileHandler.getSourceFile(filePath);

  if (!sourceFile) {
    throw Error(`Source file ${filePath} not found`);
  }

  const newSourceFile = patchSourceFile(sourceFile, patch);
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

export const patchSourceFile = (
  sourceFile: ts.SourceFile,
  patch: Patch
): result.Result<ts.SourceFile, ValSyntaxErrorTree | PatchError> => {
  const ops = new TSOps((document) => {
    return pipe(
      analyzeValModule(document),
      result.map(({ source }) => source)
    );
  });
  return applyPatch(sourceFile, ops, patch);
};
