import {
  Internal,
  type SerializedVideoSchema,
  type VideoCaptionSource,
  type GalleryVideoSource,
  type VideoPosterSource,
  type VideoSource,
} from "@valbuild/core";
import type { JSONValue, Patch } from "@valbuild/core/patch";
import { isPlaylistPath, mapPlaylistUris } from "./hlsPlaylist";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type RemoteUploadConfig = {
  publicProjectId: string;
  coreVersion: string;
  bucket: string;
  remoteHost: string;
};

/** A file about to be uploaded: its bytes, and the same bytes as a data URL. */
export type UploadFile = {
  bytes: Uint8Array;
  dataUrl: string;
  mimeType: string;
  /** SHA-256 of `bytes`, hex. */
  sha256: string;
};

export type VideoUpload =
  | { kind: "file"; file: UploadFile }
  | {
      kind: "hls";
      /**
       * Every file of the stream by its name relative to the master playlist,
       * the master itself named `master.m3u8`. Playlists name the others by
       * those relative names.
       */
      files: Record<string, UploadFile>;
      /** Of the ORIGINAL upload: names the directory, as a file's hash names a file. */
      sourceSha256: string;
      sourceMimeType: string;
    };

export type PosterUpload = UploadFile & { width: number; height: number };

export type CreateVideoPatchInput = {
  patchPath: string[];
  /** e.g. `/public/val`. */
  dir: string;
  /** The name the editor's file had; the stored name is derived from it. */
  filename: string | null;
  upload: VideoUpload;
  metadata: { width: number; height: number; duration: number };
  poster: PosterUpload | null;
  posterTime: number | null;
  /**
   * The authored fields a NEW file keeps. A replaced video is usually the same
   * video re-cut or re-exported, so its description, focal point and captions
   * still apply. Its times do not — they are positions in the old file — and
   * neither does the poster taken at one of them.
   */
  keep: Pick<VideoSource, "alt" | "hotspot" | "captions">;
  remote: RemoteUploadConfig | null;
  schema: SerializedVideoSchema;
};

export type Placed = {
  /** What the source names the file by: the local path, or the remote ref. */
  ref: string;
  file: UploadFile;
};

function ext(path: string): string {
  return path.split(".").pop() ?? "";
}

/**
 * Where a file goes, and the name the source will use for it.
 *
 * `localPath` is always under `/public`; a remote ref encodes that path, the
 * content hash and a validation hash, the same way `createFilePatch` makes one
 * for an image.
 */
function place(
  localPath: string,
  file: UploadFile,
  input: Pick<CreateVideoPatchInput, "remote" | "schema">,
  metadata: Record<string, unknown>,
): Placed {
  if (!input.remote) {
    return { ref: localPath, file };
  }
  const remoteFileHash = Internal.remote.hashToRemoteFileHash(file.sha256);
  const ref = Internal.remote.createRemoteRef(input.remote.remoteHost, {
    publicProjectId: input.remote.publicProjectId,
    coreVersion: input.remote.coreVersion,
    bucket: input.remote.bucket,
    validationHash: Internal.remote.getValidationHash(
      input.remote.coreVersion,
      input.schema,
      ext(localPath),
      metadata,
      remoteFileHash,
      textEncoder,
    ),
    fileHash: remoteFileHash,
    filePath: localPath.slice(1) as `public/${string}`,
  });
  return { ref, file };
}

/** The stored name for an upload: `intro_3b9d7.mp4`, as for an image. */
export function storedFilename(
  filename: string | null,
  mimeType: string,
  sha256: string,
): string {
  return (
    Internal.createFilename(
      // `createFilename` reads the extension from a data URL's mime type and
      // nothing else from it.
      `data:${mimeType};base64,`,
      filename,
      { mimeType },
      sha256,
    ) ?? `${sha256}.${Internal.mimeTypeToFileExt(mimeType)}`
  );
}

/** An upload made from text — a playlist rewritten to name remote refs. */
function textFile(
  text: string,
  mimeType: string,
  sha256: (bytes: Uint8Array) => string,
): UploadFile {
  const bytes = textEncoder.encode(text);
  return {
    bytes,
    mimeType,
    sha256: sha256(bytes),
    dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Place every file of an HLS stream, bottom-up.
 *
 * Locally the playlists are uploaded as they are: their names are relative,
 * and the files sit next to each other under `/public`.
 *
 * Remotely they cannot be. The content host serves a file by its hash, so a
 * relative name resolves to nothing there, and every playlist has to name the
 * REF of each file it lists — which is why the segment files are placed
 * first, then the media playlists (rewritten to name the segments' refs and
 * hashed only after that), then the master.
 */
export function placeHls(
  directory: string,
  files: Record<string, UploadFile>,
  input: Pick<CreateVideoPatchInput, "remote" | "schema">,
  sha256: (bytes: Uint8Array) => string,
): { master: Placed; all: Placed[] } {
  const placed = new Map<string, Placed>();
  const all: Placed[] = [];
  const names = Object.keys(files);
  const order = [
    ...names.filter((name) => !isPlaylistPath(name)),
    ...names.filter((name) => isPlaylistPath(name) && name !== "master.m3u8"),
    ...names.filter((name) => name === "master.m3u8"),
  ];
  for (const name of order) {
    let file = files[name];
    if (input.remote && isPlaylistPath(name)) {
      const text = mapPlaylistUris(textDecoder.decode(file.bytes), (uri) => {
        const target = placed.get(uri);
        if (!target) {
          throw new Error(
            `The playlist ${name} names ${uri}, which the converter did not produce.`,
          );
        }
        return target.ref;
      });
      file = textFile(text, file.mimeType, sha256);
    }
    const result = place(`${directory}/${name}`, file, input, {
      mimeType: file.mimeType,
    });
    placed.set(name, result);
    all.push(result);
  }
  const master = placed.get("master.m3u8");
  if (!master) {
    throw new Error("The converter produced no master playlist.");
  }
  return { master, all };
}

/**
 * The patch that puts a new video into a field: one `replace` with the whole
 * value, and one `file` op per file — the video (or every file of its stream)
 * and the poster.
 *
 * Every file op names the video FIELD as its `path`, because that is where the
 * server stamps the `patch_id` that makes a draft servable. The poster's op
 * says `nestedFilePath: ["poster"]` so its `patch_id` lands on the poster
 * rather than on the video.
 */
export function createVideoPatch(
  input: CreateVideoPatchInput,
  sha256: (bytes: Uint8Array) => string,
): { patch: Patch; value: VideoSource } {
  const built = buildVideoPatch(input, sha256, true);
  return {
    patch: built.patch,
    value: { ...built.value, ...built.entry.value },
  };
}

/**
 * The same upload into a field that picks from an `s.videoset()`: the field's
 * value names the video and carries what is the field's own — description,
 * focal point, poster, captions — and `entry` is what the SET gets, written
 * once the bytes are up. The bytes are filed at the field, so the field
 * carries the `patch_id` a page reads a draft's URL off.
 */
export function createSetBackedVideoPatch(
  input: CreateVideoPatchInput,
  sha256: (bytes: Uint8Array) => string,
): { patch: Patch; value: GalleryVideoSource; entry: VideosetEntry } {
  return buildVideoPatch(input, sha256, false);
}

function buildVideoPatch(
  input: CreateVideoPatchInput,
  sha256: (bytes: Uint8Array) => string,
  ownMetadata: boolean,
): { patch: Patch; value: GalleryVideoSource; entry: VideosetEntry } {
  const dir = input.dir.replace(/\/+$/, "");
  const { video, files: videoFiles, mimeType } = placeVideo(input, sha256);
  let poster: VideoPosterSource | undefined;
  let posterPlaced: Placed | null = null;
  if (input.poster) {
    const videoName = (video.ref.split("/").pop() ?? "video").replace(
      /\.[^.]*$/,
      "",
    );
    const baseName =
      input.upload.kind === "hls"
        ? (video.ref.split("/").slice(-2, -1)[0] ?? videoName)
        : videoName;
    const posterName = storedFilename(
      `${stripHashSuffix(baseName)}-poster.${Internal.mimeTypeToFileExt(input.poster.mimeType)}`,
      input.poster.mimeType,
      input.poster.sha256,
    );
    posterPlaced = place(`${dir}/${posterName}`, input.poster, input, {
      mimeType: input.poster.mimeType,
      width: input.poster.width,
      height: input.poster.height,
    });
    poster = {
      path: posterPlaced.ref,
      width: input.poster.width,
      height: input.poster.height,
      mimeType: input.poster.mimeType,
    };
  }

  const entry: VideosetEntry = {
    key: video.ref,
    value: {
      mimeType,
      width: input.metadata.width,
      height: input.metadata.height,
      duration: roundTime(input.metadata.duration),
    },
  };
  const value: GalleryVideoSource = {
    path: video.ref,
    // A set-backed field names its video and nothing more: what is true of
    // the file is the set's, and core refuses a field that repeats it.
    ...(ownMetadata ? entry.value : {}),
    ...(input.keep.alt !== undefined ? { alt: input.keep.alt } : {}),
    ...(input.keep.hotspot !== undefined
      ? { hotspot: input.keep.hotspot }
      : {}),
    ...(input.posterTime !== null && poster
      ? { posterTime: roundTime(input.posterTime), poster }
      : {}),
    // Kept WITH their `patch_id`s: a track uploaded in a change that is not
    // published yet is served by that id, and the server stamps it only when
    // the patch that uploaded it is applied. `toExpression` drops it on the
    // way into a `.val.ts`, as it does for every media source.
    ...(input.keep.captions !== undefined
      ? { captions: input.keep.captions }
      : {}),
  };

  const patch: Patch = [
    { op: "replace", path: input.patchPath, value: toJson(value) },
    ...videoFiles.map((placed): Patch[number] => ({
      op: "file",
      path: input.patchPath,
      filePath: placed.ref,
      value: placed.file.dataUrl,
      metadata: { mimeType: placed.file.mimeType },
      remote: input.remote !== null,
    })),
    ...(posterPlaced
      ? [
          {
            op: "file" as const,
            path: input.patchPath,
            nestedFilePath: ["poster"],
            filePath: posterPlaced.ref,
            value: posterPlaced.file.dataUrl,
            metadata: {
              mimeType: posterPlaced.file.mimeType,
              width: input.poster?.width ?? 0,
              height: input.poster?.height ?? 0,
            },
            remote: input.remote !== null,
          },
        ]
      : []),
  ];
  return { patch, value, entry };
}

/** What an `s.videoset()` entry is keyed by, and what it holds. */
export type VideosetEntry = {
  key: string;
  value: { mimeType: string; width: number; height: number; duration: number };
};

/**
 * The video's own files, placed: one file, or every file of a stream with
 * the master playlist as the one the source names.
 */
function placeVideo(
  input: Pick<
    CreateVideoPatchInput,
    "dir" | "filename" | "upload" | "metadata" | "remote" | "schema"
  >,
  sha256: (bytes: Uint8Array) => string,
): { video: Placed; files: Placed[]; mimeType: string } {
  const dir = input.dir.replace(/\/+$/, "");
  if (input.upload.kind === "file") {
    const name = storedFilename(
      input.filename,
      input.upload.file.mimeType,
      input.upload.file.sha256,
    );
    const video = place(`${dir}/${name}`, input.upload.file, input, {
      mimeType: input.upload.file.mimeType,
      width: input.metadata.width,
      height: input.metadata.height,
    });
    return { video, files: [video], mimeType: input.upload.file.mimeType };
  }
  const directory = `${dir}/${storedFilename(
    input.filename,
    input.upload.sourceMimeType,
    input.upload.sourceSha256,
  ).replace(/\.[^./]*$/, "")}`;
  const hls = placeHls(directory, input.upload.files, input, sha256);
  return {
    video: hls.master,
    files: hls.all,
    mimeType: Internal.media.HLS_MIME_TYPE,
  };
}

/**
 * The patch that adds an upload to an `s.videoset()`: the entry, keyed by
 * the video's path (an HLS stream's by its master playlist), and one `file`
 * op per file, filed AT the entry — where the server stamps the `patch_id`
 * the set's own previews are served by.
 *
 * `setPatchPath` is the set record's own patch path: `[]` for a module root.
 */
export function createVideosetEntryPatch(
  input: Pick<
    CreateVideoPatchInput,
    "dir" | "filename" | "upload" | "metadata" | "remote" | "schema"
  > & { setPatchPath: string[] },
  sha256: (bytes: Uint8Array) => string,
): { patch: Patch; entry: VideosetEntry } {
  const { video, files, mimeType } = placeVideo(input, sha256);
  const entry: VideosetEntry = {
    key: video.ref,
    value: {
      mimeType,
      width: input.metadata.width,
      height: input.metadata.height,
      duration: roundTime(input.metadata.duration),
    },
  };
  const at = input.setPatchPath.concat(entry.key);
  return {
    entry,
    patch: [
      { op: "add", path: at, value: { ...entry.value, alt: null } },
      ...files.map((placed): Patch[number] => ({
        op: "file",
        path: at,
        filePath: placed.ref,
        value: placed.file.dataUrl,
        metadata: { mimeType: placed.file.mimeType },
        remote: input.remote !== null,
      })),
    ],
  };
}

/**
 * A new poster for a video that is already there: the image, and the time it
 * was taken at.
 */
export function createPosterPatch(input: {
  patchPath: string[];
  dir: string;
  videoPath: string;
  poster: PosterUpload;
  posterTime: number;
  remote: RemoteUploadConfig | null;
  schema: SerializedVideoSchema;
}): Patch {
  const localVideoPath = localPathOf(input.videoPath);
  const isHls = isPlaylistPath(localVideoPath);
  const segments = localVideoPath.split("/");
  const baseName = (
    isHls ? segments[segments.length - 2] : segments[segments.length - 1]
  ).replace(/\.[^.]*$/, "");
  const posterName = storedFilename(
    `${stripHashSuffix(baseName)}-poster.${Internal.mimeTypeToFileExt(input.poster.mimeType)}`,
    input.poster.mimeType,
    input.poster.sha256,
  );
  const placed = place(
    `${input.dir.replace(/\/+$/, "")}/${posterName}`,
    input.poster,
    input,
    {
      mimeType: input.poster.mimeType,
      width: input.poster.width,
      height: input.poster.height,
    },
  );
  const poster: VideoPosterSource = {
    path: placed.ref,
    width: input.poster.width,
    height: input.poster.height,
    mimeType: input.poster.mimeType,
  };
  return [
    // "add", never "replace": see `ImageField`'s alt text. On an object key it
    // is create-or-set, so it survives the key having gone away meanwhile.
    {
      op: "add",
      path: input.patchPath.concat("posterTime"),
      value: roundTime(input.posterTime),
    },
    {
      op: "add",
      path: input.patchPath.concat("poster"),
      value: toJson(poster),
    },
    {
      op: "file",
      path: input.patchPath,
      nestedFilePath: ["poster"],
      filePath: placed.ref,
      value: placed.file.dataUrl,
      metadata: {
        mimeType: placed.file.mimeType,
        width: input.poster.width,
        height: input.poster.height,
      },
      remote: input.remote !== null,
    },
  ];
}

/**
 * Add a caption track at `index` — the end of the list, or the first entry of
 * a list that does not exist yet.
 */
export function createCaptionPatch(input: {
  patchPath: string[];
  dir: string;
  filename: string | null;
  file: UploadFile;
  track: Omit<VideoCaptionSource, "path" | "patch_id">;
  existing: readonly VideoCaptionSource[] | undefined;
  remote: RemoteUploadConfig | null;
  schema: SerializedVideoSchema;
}): Patch {
  const name = storedFilename(input.filename, "text/vtt", input.file.sha256);
  const placed = place(
    `${input.dir.replace(/\/+$/, "")}/${name}`,
    input.file,
    input,
    { mimeType: "text/vtt" },
  );
  const track: VideoCaptionSource = { ...input.track, path: placed.ref };
  const index = input.existing?.length ?? 0;
  return [
    input.existing === undefined
      ? {
          op: "add",
          path: input.patchPath.concat("captions"),
          value: [toJson(track)],
        }
      : {
          op: "add",
          path: input.patchPath.concat("captions", String(index)),
          value: toJson(track),
        },
    {
      op: "file",
      path: input.patchPath,
      nestedFilePath: ["captions", String(index)],
      filePath: placed.ref,
      value: placed.file.dataUrl,
      metadata: { mimeType: "text/vtt" },
      remote: input.remote !== null,
    },
  ];
}

/** Times are kept to the hundredth: a frame is 1/24 to 1/60 of a second. */
export function roundTime(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

/** The `/public/...` path a remote ref encodes, or the path itself. */
export function localPathOf(path: string): string {
  const split = Internal.remote.splitRemoteRef(path);
  return split.status === "success" ? `/${split.filePath}` : path;
}

function stripHashSuffix(name: string): string {
  return name.replace(/_[0-9a-f]{5}$/, "");
}

/**
 * A source as the JSON a patch carries. `undefined` is not JSON: a key set to
 * it would be written as a missing key by one side and as `null` by another.
 */
function toJson(value: object): JSONValue {
  return JSON.parse(JSON.stringify(value));
}
