import { Internal, type SerializedVideoSchema } from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { mapPlaylistUris, playlistUris, isPlaylistPath } from "./hlsPlaylist";
import {
  bytesToBase64,
  localPathOf,
  placeHls,
  type RemoteUploadConfig,
  type UploadFile,
} from "./createVideoPatch";
import { hashSuffixOf } from "../renameMediaFile";

/**
 * Renaming an HLS stream: the directory is the name.
 *
 * A progressive video is one file and renames like any other
 * (`renameMediaFile.ts`). A stream is a directory — `intro_3b9d7/` holding
 * `master.m3u8` and everything it names — so renaming it moves every file in
 * it. The bytes are read back from where the Studio plays them, the playlists
 * are normalised to name each other RELATIVELY again, and the whole stream is
 * placed under the new directory exactly as a fresh upload would be
 * (`placeHls`): relative names locally, refs rewritten bottom-up remotely.
 *
 * Remote streams are re-placed too, rather than only relabelled. A published
 * remote file would survive a new label (the content host serves by hash), but
 * a DRAFT one is found by the ref it was uploaded under, and a playlist whose
 * inner refs still carry the old labels would send the draft endpoint looking
 * for files under the new patch that were filed under the old one.
 */

/** The directory a stream lives in, and the name an editor edits. */
export function streamDirectoryOf(masterPath: string): {
  parent: string;
  name: string;
} | null {
  const local = localPathOf(masterPath);
  if (!isPlaylistPath(local)) {
    return null;
  }
  const segments = local.split("/");
  if (segments.length < 4) {
    // `/public/<dir>/master.m3u8` at the least: a master directly in /public
    // has no directory of its own to rename.
    return null;
  }
  return {
    parent: segments.slice(0, -2).join("/"),
    name: segments[segments.length - 2],
  };
}

export type FetchedFile = {
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
};

/**
 * Every file of a stream, by its name relative to the master's directory, with
 * every playlist rewritten to name the others relatively.
 *
 * What a served playlist names depends on where it was served from — a
 * relative name (published locally), the draft endpoint
 * (`/api/val/files/…?patch_id=…`, rewritten by the server) or a remote ref —
 * and all three are read back to the same local path.
 */
export async function readStream(
  masterPath: string,
  masterUrl: string,
  fetchFile: (url: string) => Promise<FetchedFile>,
  baseUrl: string,
): Promise<Record<string, FetchedFile>> {
  const masterLocal = localPathOf(masterPath);
  const root = masterLocal.slice(0, masterLocal.lastIndexOf("/"));
  const files: Record<string, FetchedFile> = {};
  const pending: { local: string; url: string }[] = [
    { local: masterLocal, url: new URL(masterUrl, baseUrl).toString() },
  ];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const next = pending.shift();
    if (next === undefined || seen.has(next.local)) {
      continue;
    }
    seen.add(next.local);
    if (!next.local.startsWith(`${root}/`)) {
      throw new Error(
        `The stream names ${next.local}, which is outside its own directory, so Val cannot rename it.`,
      );
    }
    const name = next.local.slice(root.length + 1);
    const fetched = await fetchFile(next.url);
    if (!isPlaylistPath(next.local)) {
      files[name] = fetched;
      continue;
    }
    const text = new TextDecoder().decode(fetched.bytes);
    const dir = next.local.slice(0, next.local.lastIndexOf("/"));
    const relative = new Map<string, string>();
    for (const uri of playlistUris(text)) {
      const local = localOfUri(uri, next.local);
      if (local === null) {
        continue;
      }
      pending.push({ local, url: new URL(uri, next.url).toString() });
      relative.set(uri, relativePath(dir, local));
    }
    const rewritten = mapPlaylistUris(text, (uri) => relative.get(uri) ?? uri);
    files[name] = {
      bytes: new TextEncoder().encode(rewritten),
      mimeType: fetched.mimeType,
    };
  }
  return files;
}

/** The `/public/...` path a playlist URI names, or null for one it does not. */
export function localOfUri(uri: string, playlistLocal: string): string | null {
  const remote = Internal.remote.splitRemoteRef(uri);
  if (remote.status === "success") {
    return `/${remote.filePath}`;
  }
  const draft =
    /^(?:https?:\/\/[^/]+)?\/api\/val\/files(\/public\/[^?#]*)/.exec(uri);
  if (draft) {
    return decodeURI(draft[1]);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("/")) {
    return null;
  }
  const dir = playlistLocal.slice(0, playlistLocal.lastIndexOf("/"));
  return normalize(`${dir}/${uri.split(/[?#]/)[0]}`);
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "..") {
      out.pop();
    } else if (segment !== "." && segment !== "") {
      out.push(segment);
    }
  }
  return `/${out.join("/")}`;
}

function relativePath(fromDir: string, to: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const target = to.split("/").filter(Boolean);
  let common = 0;
  while (
    common < from.length &&
    common < target.length - 1 &&
    from[common] === target[common]
  ) {
    common++;
  }
  return [...from.slice(common).map(() => ".."), ...target.slice(common)].join(
    "/",
  );
}

/** The remote placement a stream was uploaded with, read off its master ref. */
export function remoteConfigOf(masterPath: string): RemoteUploadConfig | null {
  const split = Internal.remote.splitRemoteRef(masterPath);
  if (split.status !== "success") {
    return null;
  }
  return {
    publicProjectId: split.projectId,
    coreVersion: split.version,
    bucket: split.bucket,
    remoteHost: split.remoteHost,
  };
}

export type StreamRenameResult =
  | { status: "ok"; patch: Patch; newPath: string }
  | { status: "unchanged" }
  | { status: "error"; message: string };

/**
 * The patch that moves a stream to a directory named `newBase_<hash>`:
 * `path` pointed at the new master, every file uploaded under the new
 * directory, and — for a local stream — every old file deleted, because a
 * rename that left them would be a copy.
 */
export function buildStreamRenamePatch(args: {
  patchPath: string[];
  masterPath: string;
  newBase: string;
  files: Record<string, FetchedFile>;
  schema: SerializedVideoSchema;
  sha256: (bytes: Uint8Array) => string;
}): StreamRenameResult {
  const directory = streamDirectoryOf(args.masterPath);
  if (directory === null) {
    return {
      status: "error",
      message: "Only a stream in a directory of its own can be renamed.",
    };
  }
  if (!("master.m3u8" in args.files)) {
    return {
      status: "error",
      message: "The stream's master playlist could not be read.",
    };
  }
  const hash =
    hashSuffixOf(directory.name) ??
    args.sha256(args.files["master.m3u8"].bytes).slice(0, 5);
  const newName = Internal.createRenamedFilename(args.newBase, hash, "");
  if (newName === null) {
    return {
      status: "error",
      message:
        "That name has no letters or digits Val can use in a file name. Try plain letters, digits and dashes.",
    };
  }
  if (newName === directory.name) {
    return { status: "unchanged" };
  }
  const uploads: Record<string, UploadFile> = {};
  for (const [name, file] of Object.entries(args.files)) {
    uploads[name] = {
      bytes: file.bytes,
      mimeType: file.mimeType,
      sha256: args.sha256(file.bytes),
      dataUrl: `data:${file.mimeType};base64,${bytesToBase64(file.bytes)}`,
    };
  }
  const remote = remoteConfigOf(args.masterPath);
  const placed = placeHls(
    `${directory.parent}/${newName}`,
    uploads,
    { remote, schema: args.schema },
    args.sha256,
  );
  const patch: Patch = [
    // "add" on the key, never a whole-value replace: the description, times
    // and captions beside it stay exactly as they are.
    {
      op: "add",
      path: args.patchPath.concat("path"),
      value: placed.master.ref,
    },
    ...placed.all.map((file): Patch[number] => ({
      op: "file",
      path: args.patchPath,
      filePath: file.ref,
      value: file.file.dataUrl,
      metadata: { mimeType: file.file.mimeType },
      remote: remote !== null,
    })),
    // Remote bytes are stored by hash, so there is nothing to delete — and a
    // remote delete would be filed under a URL `ValOpsFS` reads as a path.
    ...(remote === null
      ? Object.keys(args.files).map((name): Patch[number] => ({
          op: "file",
          path: args.patchPath,
          filePath: `/${[...directory.parent.split("/").filter(Boolean), directory.name, name].join("/")}`,
          value: null,
          remote: false,
        }))
      : []),
  ];
  return { status: "ok", patch, newPath: placed.master.ref };
}
