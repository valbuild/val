import type { AffectedFile, BinaryFileRef } from "./types";

/**
 * Turn a commit's binary files into descriptors, WITHOUT fetching any of them.
 *
 * Pure, and that is the whole design. Showing that a commit changed six images
 * needs six rows, not six downloads; only an `<img>` that actually mounts pays
 * for its bytes. `url` points at the app's own history file route, which is
 * immutable for a given commit, so the browser's HTTP cache handles flipping
 * between commits with no JS cache at all.
 */
export function describeBinaryFilesAtCommit(
  commitSha: string,
  affectedFiles: AffectedFile[],
  /** Where the app serves `/api/val` from, e.g. "/api/val". */
  apiBasePath: string,
): BinaryFileRef[] {
  const refs: BinaryFileRef[] = [];
  for (const file of affectedFiles) {
    if (file.kind === "remote-binary") {
      refs.push({
        gitPath: file.ref,
        change: file.change,
        remote: true,
        url: historyFileUrl(apiBasePath, commitSha, file.ref, true),
      });
      continue;
    }
    if (file.kind !== "binary") {
      continue;
    }
    refs.push({
      gitPath: file.gitPath,
      change: file.change,
      remote: false,
      url: historyFileUrl(apiBasePath, commitSha, file.gitPath, false),
    });
  }
  return refs;
}

export function historyFileUrl(
  apiBasePath: string,
  commitSha: string,
  filePath: string,
  remote: boolean,
): string {
  const params = new URLSearchParams({ commit_sha: commitSha, path: filePath });
  if (remote) {
    params.set("remote", "true");
  }
  return `${apiBasePath}/history/files?${params.toString()}`;
}
