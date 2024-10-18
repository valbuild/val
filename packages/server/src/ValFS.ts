/**
 * A filesystem that can update and read files.
 * It does not support creating new files or directories.
 *
 */
export interface ValFS {
  readDirectory(
    rootDir: string,
    extensions: readonly string[],
    excludes: readonly string[] | undefined,
    includes: readonly string[],
    depth?: number | undefined,
  ): readonly string[];

  writeFile(
    filePath: string,
    data: string | Buffer,
    encoding: "binary" | "utf8",
  ): void;

  fileExists(filePath: string): boolean;

  readFile(filePath: string): string | undefined;

  rmFile(filePath: string): void;

  realpath(path: string): string;
}
