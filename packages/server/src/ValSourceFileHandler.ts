import ts from "typescript";
import path from "path";
import { IValFSHost } from "./ValFSHost";
import fs from "fs";

export class ValSourceFileHandler {
  constructor(
    readonly projectRoot: string,
    private readonly compilerOptions: ts.CompilerOptions,
    readonly host: IValFSHost = {
      ...ts.sys,
      writeFile: (fileName, data, encoding) => {
        fs.mkdirSync(path.dirname(fileName), { recursive: true });
        fs.writeFileSync(fileName, data, encoding);
      },
      rmFile: fs.rmSync,
    },
  ) {}

  getSourceFile(filePath: string): ts.SourceFile | undefined {
    const fileContent = this.host.readFile(filePath);
    const scriptTarget = this.compilerOptions.target ?? ts.ScriptTarget.ES2020;
    if (fileContent) {
      return ts.createSourceFile(filePath, fileContent, scriptTarget);
    }
  }

  writeSourceFile(sourceFile: ts.SourceFile) {
    return this.writeFile(
      sourceFile.fileName,
      // https://github.com/microsoft/TypeScript/issues/36174
      unescape(sourceFile.text.replace(/\\u/g, "%u")),
      "utf8",
    );
  }

  writeFile(filePath: string, content: string, encoding: "binary" | "utf8") {
    this.host.writeFile(filePath, content, encoding);
  }

  resolveSourceModulePath(
    containingFilePath: string,
    requestedModuleName: string,
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
      ts.ModuleKind.ESNext,
    );
    const resolvedModule = resolutionRes.resolvedModule;
    if (!resolvedModule) {
      throw Error(
        `Could not resolve module "${requestedModuleName}", base: "${containingFilePath}": No resolved modules returned: ${JSON.stringify(
          resolutionRes,
        )}`,
      );
    }
    return resolvedModule.resolvedFileName;
  }
}
