import ts from "typescript";
import { IValFSHost } from "./ValFSHost";

export class ValSourceFileHandler {
  constructor(
    private readonly scriptTarget: ts.ScriptTarget,
    private readonly host: IValFSHost = ts.sys
  ) {}

  getSourceFile(filePath: string): ts.SourceFile | undefined {
    const fileContent = this.host.readFile(filePath);
    if (fileContent) {
      return ts.createSourceFile(filePath, fileContent, this.scriptTarget);
    }
  }

  writeSourceFile(sourceFile: ts.SourceFile) {
    this.host.writeFile(sourceFile.fileName, sourceFile.text, false);
  }
}
