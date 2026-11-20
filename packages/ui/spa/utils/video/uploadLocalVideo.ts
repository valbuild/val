import {
  Internal,
  type Json,
  type ModuleFilePath,
  type SerializedRecordSchema,
  type SerializedVideoSchema,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import type { JSONValue, Operation, Patch } from "@valbuild/core/patch";
import { bytesToBase64, type RemoteUploadConfig } from "./createVideoPatch";
import { isPlaylistPath, mapPlaylistUris, playlistUris } from "./hlsPlaylist";
import { localOfUri } from "./renameVideo";
import type { MediaReferrer } from "../renameMediaFile";
import { publicFilePathOf } from "../uploadLocalMedia";

/**
 * Uploading a video's local files, from the Studio: what `val validate --fix`
 * does for `video:upload-remote` and `videos:upload-remote`
 * (`createVideoUploader` in `server/src/videoRemote.ts`), so a hosted project
 * -- which has no CLI -- can move its template's videos to remote storage.
 * The image and file version, and why it is made in the browser at all, is
 * `uploadLocalMedia.ts`.
 *
 * A video names several files: the video itself (or an HLS stream's master
 * playlist, which names media playlists, which name segments), a poster and
 * caption tracks. Each local one goes up, and a playlist goes up AFTER
 * everything it names, rewritten to name their refs: the content host serves
 * a file by its hash, so a relative name in a playlist resolves to nothing
 * there, and a playlist's own ref is the hash of its rewritten bytes.
 *
 * Every ref is hashed as the CLI hashes it -- the same schema, the same
 * metadata (`metadataOf`) -- so a video moved here and one moved by `--fix`
 * carry the same refs.
 */

/** What a file is to the video that names it, which decides its hash basis. */
type VideoFileRole = "video" | "poster" | "caption" | "stream";

/** A local file's bytes, read back from where the Studio serves it. */
export type ReadLocalFile = (
  localPath: string,
) => Promise<Uint8Array<ArrayBuffer>>;

/** One file going up: where it was, the ref it gets, and its bytes. */
export type PlacedVideoFile = {
  localPath: string;
  ref: string;
  dataUrl: string;
  mimeType: string;
  /** What the `file` op says about it: a poster's size too, as an upload's. */
  metadata: JSONValue;
  /**
   * Where in the video value the file belongs, for the `file` op's
   * `nestedFilePath`: `[]` for the video and its stream, `["poster"]`,
   * `["captions", "0"]`. That is where the server stamps the patch id a draft
   * is served by.
   */
  owner: string[];
};

/** The paths a video value holds, each with where in the value it sits. */
export function videoPathsOf(
  video: Record<string, Json>,
): { at: string[]; path: string }[] {
  if (typeof video.path !== "string") {
    return [];
  }
  const found = [{ at: ["path"], path: video.path }];
  const poster = video.poster;
  if (isJsonObject(poster) && typeof poster.path === "string") {
    found.push({ at: ["poster", "path"], path: poster.path });
  }
  const captions = video.captions;
  if (Array.isArray(captions)) {
    captions.forEach((track, index) => {
      if (isJsonObject(track) && typeof track.path === "string") {
        found.push({
          at: ["captions", String(index), "path"],
          path: track.path,
        });
      }
    });
  }
  return found;
}

/**
 * Read and place every local file in `paths` -- and for a playlist, every file
 * it names -- bottom-up. Throws with a message for a person when a file
 * cannot be read: nothing has been written by then.
 */
export async function placeLocalVideoFiles(args: {
  paths: { at: string[]; path: string }[];
  /** The value the paths are in: its width, height and poster are hashed. */
  video: Record<string, Json>;
  schema: SerializedVideoSchema;
  remote: RemoteUploadConfig;
  read: ReadLocalFile;
  sha256: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
}): Promise<PlacedVideoFile[]> {
  const { video, schema, remote, read, sha256 } = args;
  const placed = new Map<string, PlacedVideoFile>();
  const textEncoder = new TextEncoder();

  const put = async (
    localPath: string,
    role: VideoFileRole,
    owner: string[],
  ): Promise<string> => {
    const already = placed.get(localPath);
    if (already !== undefined) {
      return already.ref;
    }
    const filePath = publicFilePathOf(localPath);
    if (filePath === null) {
      // A playlist naming a file outside /public: nothing a ref can name.
      throw new Error(
        `The video names ${localPath}, which is not a file under /public.`,
      );
    }
    let bytes = await read(localPath);
    if (isPlaylistPath(localPath)) {
      // What a served playlist names depends on where it was served from: a
      // relative name, or the draft endpoint. Both read back to a local path.
      const text = new TextDecoder().decode(bytes);
      const refs = new Map<string, string>();
      for (const uri of playlistUris(text)) {
        const target = localOfUri(uri, localPath);
        if (target !== null) {
          refs.set(uri, await put(target, "stream", owner));
        }
      }
      bytes = textEncoder.encode(
        mapPlaylistUris(text, (uri) => refs.get(uri) ?? uri),
      );
    }
    const mimeType =
      Internal.filenameToMimeType(localPath) ?? "application/octet-stream";
    const fileHash = Internal.remote.hashToRemoteFileHash(await sha256(bytes));
    const ref = Internal.remote.createRemoteRef(remote.remoteHost, {
      publicProjectId: remote.publicProjectId,
      coreVersion: remote.coreVersion,
      bucket: remote.bucket,
      validationHash: Internal.remote.getValidationHash(
        remote.coreVersion,
        schema,
        localPath.split(".").pop() ?? "",
        metadataOf(localPath, role, video),
        fileHash,
        textEncoder,
      ),
      fileHash,
      filePath,
    });
    const poster = video.poster;
    placed.set(localPath, {
      localPath,
      ref,
      dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
      mimeType,
      metadata:
        role === "poster" &&
        isJsonObject(poster) &&
        typeof poster.width === "number" &&
        typeof poster.height === "number"
          ? { mimeType, width: poster.width, height: poster.height }
          : { mimeType },
      owner,
    });
    return ref;
  };

  for (const { at, path } of args.paths) {
    if (Internal.isRemoteMediaPath(path) || !path.startsWith("/public/")) {
      continue;
    }
    const role: VideoFileRole =
      at[0] === "poster"
        ? "poster"
        : at[0] === "captions"
          ? "caption"
          : "video";
    await put(path, role, at.slice(0, -1));
  }
  return [...placed.values()];
}

/**
 * What a file's validation hash is computed from: `metadataOf` in
 * `server/src/videoRemote.ts`, which has to stay identical to this.
 */
function metadataOf(
  localPath: string,
  role: VideoFileRole,
  video: Record<string, Json>,
): Record<string, unknown> {
  const mimeType = Internal.filenameToMimeType(localPath);
  if (role === "video") {
    return { mimeType, width: video.width, height: video.height };
  }
  const poster = video.poster;
  if (role === "poster" && isJsonObject(poster)) {
    return {
      mimeType: poster.mimeType ?? mimeType,
      width: poster.width,
      height: poster.height,
    };
  }
  return { mimeType };
}

/** The `file` ops for `files`, filed at `at`. */
function fileOps(files: PlacedVideoFile[], at: string[]): Operation[] {
  return files.map((file) => ({
    op: "file",
    path: at,
    ...(file.owner.length > 0 ? { nestedFilePath: file.owner } : {}),
    filePath: file.ref,
    value: file.dataUrl,
    metadata: file.metadata,
    remote: true,
  }));
}

/** Local path → ref, for the files a value names directly. */
function refsOf(files: PlacedVideoFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.localPath, file.ref]));
}

/**
 * A video FIELD's patch: each path that moved is pointed at its ref (`add`,
 * so the authored fields beside it are never rewritten), and the bytes are
 * filed at the field.
 */
export function videoFieldUploadPatch(
  patchPath: string[],
  video: Record<string, Json>,
  files: PlacedVideoFile[],
): Patch {
  const refs = refsOf(files);
  const patch: Patch = [];
  for (const { at, path } of videoPathsOf(video)) {
    const to = refs.get(path);
    if (to !== undefined) {
      patch.push({ op: "add", path: [...patchPath, ...at], value: to });
    }
  }
  return [...patch, ...fileOps(files, patchPath)];
}

/**
 * An `s.videodir()` entry's patches. A local KEY is renamed to the video's
 * ref (an HLS stream's master playlist's), and every field that picked the
 * entry is pointed at it; the entry's own poster and captions are pointed at
 * theirs. The bytes are filed at the entry.
 */
export function videosetEntryUploadPatches(args: {
  moduleFilePath: ModuleFilePath;
  /** Patch path of the set record itself (`[]` for a module root). */
  patchPath: string[];
  key: string;
  entry: Record<string, Json>;
  existingKeys: readonly string[];
  referrers: MediaReferrer[];
  files: PlacedVideoFile[];
}):
  | {
      status: "ok";
      primary: { moduleFilePath: ModuleFilePath; patch: Patch };
      referrers: { moduleFilePath: ModuleFilePath; patch: Patch }[];
    }
  | { status: "error"; message: string } {
  const refs = refsOf(args.files);
  const newKey = refs.get(args.key) ?? args.key;
  if (newKey !== args.key && args.existingKeys.includes(newKey)) {
    return {
      status: "error",
      message:
        "The video set already has this video uploaded. Remove one of the two entries, then try again.",
    };
  }
  const fromPath = [...args.patchPath, args.key];
  const toPath = [...args.patchPath, newKey];
  if (!array.isNonEmpty(fromPath) || !array.isNonEmpty(toPath)) {
    return { status: "error", message: "Not a video set entry." };
  }
  const patch: Patch =
    newKey === args.key ? [] : [{ op: "move", from: fromPath, path: toPath }];
  // The entry's poster and captions; its key is the entry's own path, not a
  // field of it.
  for (const { at, path } of videoPathsOf({ ...args.entry, path: args.key })) {
    const to = refs.get(path);
    if (to !== undefined && at[0] !== "path") {
      patch.push({ op: "add", path: [...toPath, ...at], value: to });
    }
  }
  patch.push(...fileOps(args.files, toPath));

  const byModule = new Map<ModuleFilePath, Operation[]>();
  if (newKey !== args.key) {
    const videoFiles = args.files.filter((file) => file.owner.length === 0);
    for (const referrer of args.referrers) {
      const [moduleFilePath, modulePath] =
        Internal.splitModuleFilePathAndModulePath(referrer.sourcePath);
      const referrerPatchPath = Internal.createPatchPath(modulePath);
      const ops = byModule.get(moduleFilePath) ?? [];
      ops.push({
        op: "replace",
        path: [...referrerPatchPath, "path"],
        value: newKey,
      });
      // A draft reads its URL off its OWN `patch_id`: see
      // `MediaReferrer.hasPatchId`.
      if (referrer.hasPatchId) {
        ops.push(...fileOps(videoFiles, referrerPatchPath));
      }
      byModule.set(moduleFilePath, ops);
    }
  }
  return {
    status: "ok",
    primary: { moduleFilePath: args.moduleFilePath, patch },
    referrers: Array.from(byModule.entries()).map(([moduleFilePath, ops]) => ({
      moduleFilePath,
      patch: ops,
    })),
  };
}

/** The schema an `s.videodir()` entry's refs are hashed with, as the CLI's. */
export function videosetEntrySchema(
  record: SerializedRecordSchema,
): SerializedVideoSchema {
  return Internal.videosetEntryVideoSchema(record);
}

function isJsonObject(value: unknown): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
