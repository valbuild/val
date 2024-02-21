import minimatch from "minimatch";
import path from "path";
import { ValFS } from "./ValFS";

const SEPARATOR = "/";

export class RemoteFS implements ValFS {
  private initialized = false;
  private readonly modifiedFiles: string[];
  private readonly deletedFiles: string[];
  private data: Directories;

  constructor() {
    this.data = {};
    this.modifiedFiles = [];
    this.deletedFiles = [];
  }

  useCaseSensitiveFileNames: boolean = true;

  isInitialized(): boolean {
    return this.initialized;
  }
  async initializeWith(data: Directories): Promise<void> {
    this.data = data;
    this.initialized = true;
  }

  async getPendingOperations(): Promise<{
    modified: Record<string, string>;
    deleted: string[];
  }> {
    const modified: Record<string, string> = {};
    for (const modifiedFile in this.modifiedFiles) {
      modified[modifiedFile] = this.data[modifiedFile].utf8Files[modifiedFile];
    }

    return {
      modified: modified,
      deleted: this.deletedFiles,
    };
  }

  changedDirectories: Record<string, Set<string>> = {};

  readDirectory = (
    rootDir: string,
    extensions: readonly string[],
    excludes: readonly string[] | undefined,
    includes: readonly string[],
    depth?: number | undefined
  ): readonly string[] => {
    // TODO: rewrite this! And make some tests! This is a mess!
    // Considered using glob which typescript seems to use, but that works on an entire typeof fs
    // glob uses minimatch internally, so using that instead
    const files = [];
    for (const dir in this.data) {
      const depthExceeded = depth
        ? dir.replace(rootDir, "").split(SEPARATOR).length > depth
        : false;
      if (dir.startsWith(rootDir) && !depthExceeded) {
        for (const file in this.data[dir].utf8Files) {
          for (const extension of extensions) {
            if (file.endsWith(extension)) {
              const path = `${dir}/${file}`;
              for (const include of includes ?? []) {
                // TODO: should default includes be ['**/*']?
                if (minimatch(path, include)) {
                  let isExcluded = false;
                  for (const exlude of excludes ?? []) {
                    if (minimatch(path, exlude)) {
                      isExcluded = true;
                      break;
                    }
                  }
                  if (!isExcluded) {
                    files.push(path);
                  }
                }
              }
            }
          }
        }
      }
    }
    return files;
  };

  writeFile = (
    filePath: string,
    data: string,
    encoding: "binary" | "utf8"
  ): void => {
    const { directory, filename } = RemoteFS.parsePath(filePath);
    if (this.data[directory] === undefined) {
      throw new Error(`Directory not found: ${directory}`);
    }
    this.changedDirectories[directory] =
      this.changedDirectories[directory] ?? new Set();

    // if it fails below this should not be added, so maybe a try/catch?
    this.changedDirectories[directory].add(filename);
    if (encoding === "binary") {
      this.data[directory].binaryFiles[filename] = Buffer.from(data);
    } else {
      this.data[directory].utf8Files[filename] = data;
    }
    this.modifiedFiles.push(filePath);
  };

  rmFile(filePath: string): void {
    const { directory, filename } = RemoteFS.parsePath(filePath);
    if (this.data[directory] === undefined) {
      throw new Error(`Directory not found: ${directory}`);
    }
    this.changedDirectories[directory] =
      this.changedDirectories[directory] ?? new Set();

    // if it fails below this should not be added, so maybe a try/catch?
    this.changedDirectories[directory].add(filename);
    delete this.data[directory].utf8Files[filename];
    delete this.data[directory].binaryFiles[filename];
    delete this.data[directory].symlinks[filename];
    this.deletedFiles.push(filePath);
  }

  fileExists = (filePath: string): boolean => {
    const { directory, filename } = RemoteFS.parsePath(
      this.realpath(filePath) // ts.sys seems to resolve symlinks while calling fileExists, i.e. a broken symlink (pointing to a non-existing file) is not considered to exist
    );
    return !!this.data[directory]?.utf8Files[filename];
  };

  readBuffer = (filePath: string): Buffer | undefined => {
    const { directory, filename } = RemoteFS.parsePath(filePath);
    const dirNode = this.data[directory];
    if (!dirNode) {
      return undefined;
    }
    const content = dirNode.binaryFiles[filename];
    return content;
  };

  readFile = (filePath: string): string | undefined => {
    const { directory, filename } = RemoteFS.parsePath(filePath);
    const dirNode = this.data[directory];
    if (!dirNode) {
      return undefined;
    }
    const content = dirNode.utf8Files[filename];
    return content;
  };

  realpath(fullPath: string): string {
    // TODO: this only works in a very limited way.
    // It does not support symlinks to symlinks nor symlinked directories for instance.
    const { directory, filename } = RemoteFS.parsePath(fullPath);

    if (this.data[directory] === undefined) {
      return fullPath;
    }
    if (this.data[directory].utf8Files[filename] === undefined) {
      const link = this.data[directory].symlinks[filename];
      if (link === undefined) {
        return fullPath;
      } else {
        return link;
      }
    } else {
      return path.join(directory, filename);
    }
  }

  /**
   *
   * @param path
   * @returns directory and filename. NOTE: directory might be empty string
   */
  static parsePath(path: string): { directory: string; filename: string } {
    const pathParts = path.split(SEPARATOR);
    const filename = pathParts.pop();
    if (!filename) {
      throw new Error(`Invalid path: '${path}'. Node filename: '${filename}'`);
    }
    const directory = pathParts.join(SEPARATOR);
    return { directory, filename };
  }
}

export type DirectoryNode = {
  binaryFiles: Record<string, Buffer>; // TODO: a Map would be better here
  utf8Files: Record<string, string>; // TODO: a Map would be better here
  symlinks: Record<string, string>; // TODO: a Map would be better here
};

/**
 * Represents directories
 * NOTE: the keys of directory nodes are the "full" path, i.e. "foo/bar"
 * NOTE: the keys of file nodes are the "filename" only, i.e. "baz.txt"
 *
 * @example
 * {
 *  "foo/bar": { // <- directory. NOTE: this is the "full" path
 *     gitHubSha: "123",
 *     files: {
 *       "baz.txt": "hello world" // <- file. NOTE: this is the "filename" only
 *     },
 *   },
 * };
 */
export type Directories = Record<string, DirectoryNode>; // TODO: a Map would be better here
