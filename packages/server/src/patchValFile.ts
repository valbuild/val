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
import { derefPatch, SerializedModuleContent } from "@valbuild/lib";
import { readValFile } from "./readValFile";
import { QuickJSRuntime } from "quickjs-emscripten";
import ts from "typescript";

const ops = new TSOps((document) => {
  return pipe(
    analyzeValModule(document),
    result.map(({ source }) => source)
  );
});

// TODO: rename to patchValFiles since we may write multiple files
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

  const derefRes = derefPatch(patch, sourceFile, ops);
  if (result.isErr(derefRes)) {
    throw derefRes.error;
  }

  const dereferencedPatch = derefRes.value.dereferencedPatch; // TODO: add ref changes to remote replace/add, ...
  const newSourceFile = patchSourceFile(sourceFile, dereferencedPatch);
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
  for (const [filePath, content] of Object.entries(
    derefRes.value.fileUpdates
  )) {
    // Evaluate if we want to make these writes (more) atomic with a temp file and a move.
    // This can potentially fill mid-way if there is not enough space on disk for example...
    // However, that might be add add bit more complexity in our host and virtual file systems?
    // Example:
    // const tempFilePath = sourceFileHandler.writeTempFile(
    //   Buffer.from(content, "base64").toString("binary")
    // );
    // sourceFileHandler.moveFile(tempFilePath, "." + filePath);
    sourceFileHandler.writeFile(
      "." + filePath,
      Buffer.from(content, "base64").toString("binary")
    );
  }

  for (const [ref, patch] of Object.entries(derefRes.value.remotePatches)) {
    throw Error(
      `Cannot update remote ${ref} with ${JSON.stringify(
        patch
      )}: not implemented`
    );
  }

  sourceFileHandler.writeSourceFile(newSourceFile.value);

  return readValFile(id, valConfigPath, runtime);
};

export const patchSourceFile = (
  sourceFile: ts.SourceFile,
  patch: Patch
): result.Result<ts.SourceFile, ValSyntaxErrorTree | PatchError> => {
  return applyPatch(sourceFile, ops, patch);
};
