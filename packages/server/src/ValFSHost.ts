import path from "path";
import ts from "typescript";
import { ValFS } from "./ValFS";

/**
 * An implementation of methods in the various ts.*Host interfaces
 * that uses ValFS to resolve modules and read/write files.
 */
export interface IValFSHost
  extends ts.ParseConfigHost,
    ts.ModuleResolutionHost {
  useCaseSensitiveFileNames: boolean;

  writeFile(
    fileName: string,
    data: string | Buffer,
    encoding: "binary" | "utf8"
  ): void;
  rmFile(fileName: string): void;
}

export class ValFSHost implements IValFSHost {
  constructor(
    protected readonly valFS: ValFS,
    protected readonly currentDirectory: string
  ) {}

  useCaseSensitiveFileNames = true;
  readDirectory(
    rootDir: string,
    extensions: readonly string[],
    excludes: readonly string[] | undefined,
    includes: readonly string[],
    depth?: number | undefined
  ): readonly string[] {
    return this.valFS.readDirectory(
      rootDir,
      extensions,
      excludes,
      includes,
      depth
    );
  }

  rmFile(fileName: string): void {
    this.valFS.rmFile(fileName);
  }

  writeFile(
    fileName: string,
    text: string | Buffer,
    encoding: "binary" | "utf8"
  ): void {
    this.valFS.writeFile(fileName, text, encoding);
  }

  getCurrentDirectory(): string {
    return this.currentDirectory;
  }

  getCanonicalFileName(fileName: string): string {
    if (path.isAbsolute(fileName)) {
      return path.normalize(fileName);
    }
    return path.resolve(this.getCurrentDirectory(), fileName);
  }

  fileExists(fileName: string): boolean {
    return this.valFS.fileExists(fileName);
  }

  readFile(fileName: string): string | undefined {
    return this.valFS.readFile(fileName);
  }

  realpath(path: string): string {
    return this.valFS.realpath(path);
  }
}
