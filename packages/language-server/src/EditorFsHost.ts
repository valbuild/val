import fs from "fs";
import path from "path";
import ts from "typescript";
import type { IValFSHost } from "@valbuild/server";

/**
 * Access to the editor's in-memory view of a file.
 *
 * An editor holds unsaved ("dirty") buffers that differ from disk. Validation
 * must see what the user is looking at, not what was last saved, so every read
 * goes through this first.
 */
export type OpenDocuments = {
  /**
   * Latest editor content for an absolute filesystem path, or `undefined` if the
   * file is not open in the editor.
   */
  read(fsPath: string): string | undefined;
};

/** An {@link OpenDocuments} backed by a plain map. Useful for tests. */
export function mapOpenDocuments(
  entries: Map<string, string> = new Map(),
): OpenDocuments & { set(fsPath: string, content: string): void } {
  const normalized = new Map<string, string>();
  for (const [k, v] of entries) {
    normalized.set(path.normalize(k), v);
  }
  return {
    read: (fsPath) => normalized.get(path.normalize(fsPath)),
    set: (fsPath, content) => normalized.set(path.normalize(fsPath), content),
  };
}

/**
 * An `IValFSHost` that overlays the editor's unsaved buffers on top of the real
 * filesystem.
 *
 * `IValFSHost` is the filesystem seam that `createService`, `ValModuleLoader`
 * and `ValSourceFileHandler` all read through, so overriding it here is what
 * makes Val evaluate the user's *current* editor state. Everything else
 * delegates to `ts.sys`, exactly like the default host in
 * `@valbuild/server`'s `createService`.
 */
export function createEditorFsHost(open: OpenDocuments): IValFSHost {
  return {
    ...ts.sys,

    fileExists(fileName: string): boolean {
      // A file open in the editor but not yet written to disk still exists as
      // far as validation is concerned.
      if (open.read(fileName) !== undefined) {
        return true;
      }
      return ts.sys.fileExists(fileName);
    },

    readFile(fileName: string, encoding?: string): string | undefined {
      const overlay = open.read(fileName);
      if (overlay !== undefined) {
        return overlay;
      }
      return ts.sys.readFile(fileName, encoding);
    },

    readBuffer(fileName: string): Buffer | undefined {
      const overlay = open.read(fileName);
      if (overlay !== undefined) {
        return Buffer.from(overlay, "utf8");
      }
      try {
        return fs.readFileSync(fileName);
      } catch {
        return undefined;
      }
    },

    /**
     * Deliberately unimplemented. A language server must never write to the
     * user's files behind their back — every change goes through the editor as
     * a `workspace/applyEdit` so it lands in the undo stack and respects dirty
     * buffers. Throwing here turns an accidental write into a loud failure
     * rather than silent data loss.
     */
    writeFile(fileName: string): void {
      throw Error(
        `The Val language server must not write files directly (attempted: '${fileName}'). ` +
          `Produce a workspace edit instead.`,
      );
    },

    rmFile(fileName: string): void {
      throw Error(
        `The Val language server must not delete files directly (attempted: '${fileName}'). ` +
          `Produce a workspace edit instead.`,
      );
    },
  };
}
