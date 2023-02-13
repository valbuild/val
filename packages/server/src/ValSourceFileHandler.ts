import ts from "typescript";
import path from "path";
import { IValFSHost } from "./ValFSHost";

export class ValSourceFileHandler {
  constructor(
    private readonly projectRoot: string,
    private readonly compilerOptions: ts.CompilerOptions,
    private readonly host: IValFSHost = ts.sys
  ) {}

  getSourceFile(filePath: string): ts.SourceFile | undefined {
    const fileContent = this.host.readFile(filePath);
    const scriptTarget = this.compilerOptions.target ?? ts.ScriptTarget.ES2020;
    if (fileContent) {
      return ts.createSourceFile(filePath, fileContent, scriptTarget);
    }
  }

  writeSourceFile(sourceFile: ts.SourceFile) {
    this.host.writeFile(sourceFile.fileName, sourceFile.text, false);
  }

  resolveSourceModulePath(
    containingFilePath: string,
    requestedModuleName: string
  ): string {
    const resolutionRes = ts.resolveModuleName(
      requestedModuleName,
      path.isAbsolute(containingFilePath)
        ? containingFilePath
        : path.resolve(this.projectRoot, containingFilePath),
      this.compilerOptions,
      this.host,
      undefined,
      undefined,
      ts.ModuleKind.ESNext
    );
    const resolvedModule = resolutionRes.resolvedModule;
    if (!resolvedModule) {
      throw Error(
        `Could not resolve module "${requestedModuleName}", base: "${containingFilePath}": No resolved modules returned: ${JSON.stringify(
          resolutionRes
        )}`
      );
    }
    return resolvedModule.resolvedFileName;
  }
}
