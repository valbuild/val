import { VideoMetadata } from "@valbuild/core";
import fs from "fs";
import path from "path";
import {
  downloadFileFromRemote,
  getFileBufferFromRemote,
  type ReadRemoteFile,
} from "./checkRemoteRef";
import { extractVideoMetadataFromFile } from "./extractMetadata";

/**
 * Where `createFixPatch` reads a project file's bytes, and where it puts a
 * remote file it was asked to download.
 *
 * Every path is the file's path from the project root, the way a source names
 * it: `/public/val/logo.png`, never an absolute path on some disk. That is the
 * point: a project in http mode, or one the platform serves from a Worker, has
 * no disk to join a path onto, and a fix that reads a file has to work there
 * too. `diskFixFiles` is the one the CLI and the language server use, and does
 * exactly what `createFixPatch` did with `fs` before this existed.
 *
 * Not yet covered, and still read from `projectRoot` directly: the CLI's
 * listing of a media directory for files it does not track, and
 * `videos:check-all-files` (`videosetCheckAllFilesPatch`), which lists one.
 * See `docs/plans/studio-validate.md`.
 */
export type FixFiles = {
  /** A project file's bytes. Rejects when it cannot be read. */
  readFile(filePath: string): Promise<Buffer>;
  /**
   * A project video's size, length and mime type. Its own method rather than
   * `readFile` because a video is mostly frames, and the disk reader reads
   * only the headers.
   */
  readVideoMetadata(filePath: string): Promise<VideoMetadata>;
  /**
   * A remote file's bytes, for re-deriving a stale ref (`*:check-remote`).
   * Nothing is stored in the project.
   */
  readRemoteFile: ReadRemoteFile;
  /** Downloads `url` and stores it in the project at `filePath`. */
  saveRemoteFile(
    url: string,
    filePath: string,
  ): Promise<{ status: "success" } | { status: "error"; error: string }>;
};

/** {@link FixFiles} over a project on disk. */
export function diskFixFiles(projectRoot: string): FixFiles {
  const absolute = (filePath: string) => path.join(projectRoot, filePath);
  return {
    readFile: (filePath) => fs.promises.readFile(absolute(filePath)),
    readVideoMetadata: (filePath) =>
      extractVideoMetadataFromFile(absolute(filePath)),
    // Kept under `.val/remote-file-cache`, so the next run does not download
    // it again.
    readRemoteFile: (ref, fileExt, fileHash) =>
      getFileBufferFromRemote(ref, fileExt, fileHash, projectRoot),
    saveRemoteFile: async (url, filePath) => {
      const target = absolute(filePath);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      const res = await downloadFileFromRemote(url, target);
      return res.status === "error" ? res : { status: "success" };
    },
  };
}
