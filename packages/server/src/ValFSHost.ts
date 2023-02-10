import path from "path";
import { ValFS } from "./ValFS";

/**
 * An implementation of methods in the various ts.*Host interfaces
 * that uses ValFS to resolve modules and read/write files.
 */
export interface IValFSHost {
  useCaseSensitiveFileNames: boolean;
  readDirectory(
    rootDir: string,
    extensions: readonly string[],
    excludes: readonly string[] | undefined,
    includes: readonly string[],
    depth?: number | undefined
  ): readonly string[];

  writeFile(fileName: string, text: string, writeByteOrderMark: boolean): void;

  getCurrentDirectory?(): string;

  getCanonicalFileName?(fileName: string): string;

  fileExists(fileName: string): boolean;

  readFile(fileName: string): string | undefined;

  realpath?(path: string): string;
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

  writeFile(fileName: string, text: string, writeByteOrderMark: boolean): void {
    if (writeByteOrderMark) {
      throw new Error("writeByteOrderMark=true not implemented.");
    }
    this.valFS.writeFile(fileName, text);
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
