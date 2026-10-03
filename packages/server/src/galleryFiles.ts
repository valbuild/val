import path from "path";
import { galleryEntryOf, type GalleryEntryKey } from "./galleryEntryKey";
import type { IValFSHost } from "./ValFSHost";

/**
 * What is out of step between a gallery's entries and its directory.
 *
 * Two questions, and they treat a remote entry differently — which is the whole
 * reason this is separate from the handler around it:
 *
 * - **Missing**: an entry with no bytes at its local path. Asked of LOCAL
 *   entries only. A remote entry's bytes live on the content host, and nothing
 *   puts a copy in the working tree: `saveOrUploadFiles` uploads the remote
 *   descriptors and copies only the local ones into the tree, so a remote entry
 *   added through the Studio (or over MCP) has no local file by design, and
 *   demanding one would mean committing remote bytes to git — which is what
 *   remote storage exists to avoid. Whether those bytes really are on the host
 *   is a different check, `image:check-remote`, which already runs for exactly
 *   these entries.
 * - **Untracked**: a file in the directory that no entry claims. Asked of every
 *   entry, remote included, and that is why they are normalised to their local
 *   path: `val validate --fix` promotes a local file to a remote ref and leaves
 *   the file where it was, so a remote entry can perfectly well have one.
 *
 * An entry can claim more than its key. A video set's HLS stream is keyed by
 * its master playlist, and the media playlists and segments it names are the
 * same entry — so `filesOfEntry` says what else an entry holds, and those are
 * not untracked either.
 *
 * Its own module rather than a part of `fixHandlers.ts`, so the video set's
 * fixes can use it without importing the handler registry they are part of.
 */
export function checkGalleryFiles(input: {
  entryKeys: string[];
  dir: string;
  projectRoot: string;
  fs: Pick<IValFSHost, "fileExists" | "readDirectory">;
  /**
   * Every file an entry holds besides its key, as `/public/…` refs. Asked of
   * every entry, for the same reason untracked is.
   */
  filesOfEntry?: (entry: GalleryEntryKey, key: string) => string[];
}): { missingTrackedFiles: string[]; untrackedFiles: string[] } {
  const { dir, projectRoot, fs, filesOfEntry } = input;
  const entries = input.entryKeys.map((key) => ({
    key,
    entry: galleryEntryOf(key),
  }));
  const trackedFiles = new Set<string>();
  for (const { key, entry } of entries) {
    trackedFiles.add(entry.localPath);
    for (const file of filesOfEntry?.(entry, key) ?? []) {
      trackedFiles.add(file);
    }
  }

  const missingTrackedFiles = entries
    .filter(
      ({ entry }) =>
        !entry.remote &&
        !fs.fileExists(path.join(projectRoot, entry.localPath)),
    )
    .map(({ entry }) => entry.localPath);

  return {
    missingTrackedFiles,
    untrackedFiles: filesInDirectory({ dir, projectRoot, fs }).filter(
      (f) => !trackedFiles.has(f),
    ),
  };
}

/** Every file under `dir`, as `/public/…` refs; none for a directory not there. */
function filesInDirectory({
  dir,
  projectRoot,
  fs,
}: {
  dir: string;
  projectRoot: string;
  fs: Pick<IValFSHost, "readDirectory">;
}): string[] {
  const filesInDir: string[] = [];
  try {
    const found = fs.readDirectory(
      path.join(projectRoot, dir),
      undefined,
      undefined,
      ["**/*"],
    );
    for (const entry of found) {
      filesInDir.push(
        "/" + path.relative(projectRoot, entry).split(path.sep).join("/"),
      );
    }
  } catch {
    // directory doesn't exist — no untracked files possible
  }
  return filesInDir;
}
