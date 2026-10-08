/**
 * The fixes of an `s.videoset()` — the video twin of an image gallery.
 *
 * A set is a record keyed by each video's file path (an HLS stream by its
 * master playlist), so most of this is the gallery fixes again with the key as
 * the file. Three things are not, and they are why this is a module of its own
 * rather than another branch in `fixHandlers.ts`:
 *
 * - **An entry is several files.** A stream's key is its master playlist, and
 *   the media playlists and segments it names belong to the same entry. They
 *   are tracked by it, uploaded with it, and none of them is an entry itself.
 * - **The set's directory holds files that are not entries.** A field picked
 *   from the set (`s.video(videosVal)`) keeps its own poster and caption
 *   tracks, and the Studio puts them where the set keeps its videos. A file a
 *   video field names is accounted for, not untracked.
 * - **Fields elsewhere name an entry by its key.** Uploading an entry renames
 *   its key to the remote ref, and every `s.video(videosVal)` whose `path` was
 *   the old key would then name a video the set does not have. So the upload
 *   rewrites them too (`otherModulePatches`).
 *
 * Nothing here imports `fixHandlers.ts` at runtime: that module registers
 * these handlers, and a cycle would hand it undefined ones.
 */
import {
  extractVideoMetadataFromUrl,
  nameForTypeOf,
} from "./remoteVideoMetadata";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  Internal,
  type ModuleFilePath,
  type ModulePath,
  type SerializedRecordSchema,
  type SerializedSchema,
  type SerializedVideoSchema,
  type Source,
  type SourcePath,
  type ValidationError,
  type VideoMetadata,
} from "@valbuild/core";
import { isNotRoot, type JSONValue, type Patch } from "@valbuild/core/patch";
import { traverseSchemaSource } from "@valbuild/shared/internal";
import type { FixPatchRemainingError } from "./createFixPatch";
import type { FixFiles } from "./fixFiles";
import {
  extractVideoMetadataFromFile,
  unreadableVideoMetadataMessage,
  canReadVideoMetadata,
} from "./extractMetadata";
import type {
  FixHandlerContext,
  FixHandlerResult,
  ModulePatch,
} from "./fixHandlers";
import { checkGalleryFiles, incompleteGalleryEntries } from "./galleryFiles";
import { galleryEntryOf, type GalleryEntryKey } from "./galleryEntryKey";
import { isHlsMasterPlaylist } from "./hls";
import { openRemoteUploadSession } from "./remoteUpload";
import type { Service } from "./Service";
import { filesOfVideo } from "./videoFiles";
import {
  createVideoUploader,
  firstMissingVideoFile,
  metadataOf,
} from "./videoRemote";

/** The fields of a set entry that are read from the bytes, in the order written. */
const VIDEO_METADATA_FIELDS: readonly (keyof VideoMetadata)[] = [
  "mimeType",
  "width",
  "height",
  "duration",
];

/** What of a `Service` the project-wide walks need. */
export type VideoFieldService = Pick<Service, "getModuleFilePaths" | "get">;

type ReadFile = (absolutePath: string) => Buffer | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlaylist(ref: string): boolean {
  return ref.split("?")[0].toLowerCase().endsWith(".m3u8");
}

function readFileOrUndefined(absolutePath: string): Buffer | undefined {
  try {
    return fs.readFileSync(absolutePath);
  } catch {
    return undefined;
  }
}

/** See `Internal.videosetEntryVideoSchema`: the Studio hashes against it too. */
export function videosetEntryVideoSchema(
  record: SerializedRecordSchema,
): SerializedVideoSchema {
  return Internal.videosetEntryVideoSchema(record);
}

/** The key of the set entry at `sourcePath`: its last module path segment. */
function entryKeyOf(sourcePath: SourcePath): string | undefined {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  const parts = Internal.splitModulePath(modulePath);
  return parts[parts.length - 1];
}

/**
 * The patch path of `sourcePath`. Not `sourceToPatchPath`: a set's keys are
 * file paths, and their dots do not survive its `split(".")`.
 */
function patchPathOf(sourcePath: SourcePath): string[] {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  return Internal.splitModulePath(modulePath);
}

/**
 * Every file a set entry holds: its key's file and, for an HLS stream, every
 * playlist and segment its master names — read from the LOCAL copy, which a
 * remote entry promoted by `--fix` still has, and which is the only place a
 * stream's tree can be followed from at all.
 */
export function filesOfVideosetEntry(
  entry: GalleryEntryKey,
  metadata: unknown,
  options: { projectRoot: string; readFile?: ReadFile },
): string[] {
  const fields = isRecord(metadata) ? metadata : {};
  const mimeType =
    typeof fields.mimeType === "string" ? fields.mimeType : undefined;
  // The entry's poster and captions are its defaults' files: the set holds
  // them as it holds the video, so they are tracked by the entry — a remote
  // one by the local path it was uploaded from, as the key is.
  return filesOfVideo(
    {
      path: entry.localPath,
      mimeType,
      poster: fields.poster,
      captions: fields.captions,
    },
    options,
  ).map((ref) => galleryEntryOf(ref).localPath);
}

/**
 * An entry with every file it names that `moved` has a new ref for pointed
 * at that ref: the poster and the captions, which a remote set keeps on the
 * content host with the video.
 */
function withMovedFiles(
  entry: Record<string, unknown>,
  moved: Map<string, string>,
): Record<string, unknown> {
  const movedPath = (file: unknown) =>
    isRecord(file) && typeof file.path === "string" && moved.has(file.path)
      ? { ...file, path: moved.get(file.path) }
      : file;
  return {
    ...entry,
    ...(entry.poster !== undefined ? { poster: movedPath(entry.poster) } : {}),
    ...(Array.isArray(entry.captions)
      ? { captions: entry.captions.map(movedPath) }
      : {}),
  };
}

/** The entry's poster and caption files that are still local. */
function localFilesOfEntry(
  entry: Record<string, unknown>,
): { path: string; role: "poster" | "caption" }[] {
  const files: { path: string; role: "poster" | "caption" }[] = [];
  if (isRecord(entry.poster) && typeof entry.poster.path === "string") {
    files.push({ path: entry.poster.path, role: "poster" });
  }
  if (Array.isArray(entry.captions)) {
    for (const track of entry.captions) {
      if (isRecord(track) && typeof track.path === "string") {
        files.push({ path: track.path, role: "caption" });
      }
    }
  }
  return files.filter((file) => !Internal.isRemoteMediaPath(file.path));
}

/**
 * The untracked files of a set's directory, sorted into the ones `--fix` can
 * make entries of and the ones a person has to decide about.
 *
 * - `videos`: an untracked stream (keyed by its master playlist — the media
 *   playlists and segments it names are part of it and listed nowhere), and a
 *   progressive video the set accepts.
 * - `others`: everything else — a poster or caption no video field names, a
 *   media playlist without a master, a video of a type the set does not
 *   accept. `--fix` does not add these: none of them is a video the set could
 *   hold, and deleting someone's file is not a fix.
 */
export function classifyUntrackedVideosetFiles({
  untracked,
  accept,
  projectRoot,
  readFile = readFileOrUndefined,
}: {
  untracked: string[];
  accept: string;
  projectRoot: string;
  readFile?: ReadFile;
}): { videos: string[]; others: string[] } {
  const masters = untracked.filter((file) => {
    if (!isPlaylist(file)) {
      return false;
    }
    const text = readFile(path.join(projectRoot, file))?.toString("utf-8");
    return text !== undefined && isHlsMasterPlaylist(text);
  });
  const partOfAStream = new Set<string>();
  for (const master of masters) {
    for (const file of filesOfVideo(
      { path: master },
      { projectRoot, readFile },
    )) {
      if (file !== master) {
        partOfAStream.add(file);
      }
    }
  }
  const videos: string[] = [];
  const others: string[] = [];
  for (const file of untracked) {
    if (partOfAStream.has(file)) {
      continue;
    }
    if (masters.includes(file)) {
      videos.push(file);
      continue;
    }
    const mimeType = Internal.filenameToMimeType(file);
    if (
      mimeType !== undefined &&
      mimeType.startsWith("video/") &&
      Internal.mimeTypeMatchesAccept(mimeType, accept)
    ) {
      videos.push(file);
    } else {
      others.push(file);
    }
  }
  return { videos, others };
}

/** Whether a serialized schema has a video field anywhere in it. */
function hasVideoField(schema: unknown): boolean {
  if (Array.isArray(schema)) {
    return schema.some(hasVideoField);
  }
  if (!isRecord(schema)) {
    return false;
  }
  if (schema.type === "video") {
    return true;
  }
  return Object.values(schema).some(hasVideoField);
}

type VideoField = {
  moduleFilePath: ModuleFilePath;
  sourcePath: SourcePath;
  source: Source;
  schema: SerializedVideoSchema;
};

/**
 * Every video field in the project, with its value.
 *
 * Validated reads for the modules that have one, because only those come back
 * with their `.jsonValues()` entries loaded — an unvalidated read hands back
 * each entry as a marker, and a field inside one would be invisible. Modules
 * without a video are read once, unvalidated, to find that out.
 */
async function videoFieldsOf(
  service: VideoFieldService,
): Promise<VideoField[]> {
  const found: VideoField[] = [];
  for (const moduleFilePath of service.getModuleFilePaths()) {
    const shallow = await service.get(moduleFilePath, "" as ModulePath, {
      validate: false,
    });
    if (!hasVideoField(shallow.schema)) {
      continue;
    }
    const loaded = await service.get(moduleFilePath, "" as ModulePath, {
      validate: true,
    });
    if (loaded.source === undefined || !loaded.schema) {
      continue;
    }
    traverseSchemaSource(
      loaded.source,
      loaded.schema,
      moduleFilePath as string as SourcePath,
      ({ source, schema, path: sourcePath }) => {
        if (schema.type === "video") {
          found.push({ moduleFilePath, sourcePath, source, schema });
        }
      },
    );
  }
  return found;
}

/**
 * The files video fields name — a video of its own, and the poster and
 * captions of every field — as `/public/…` refs, a remote one by the local
 * path it was uploaded from.
 */
export async function filesNamedByVideoFields(
  service: VideoFieldService,
  options: { projectRoot: string; readFile?: ReadFile },
): Promise<Set<string>> {
  const files = new Set<string>();
  for (const field of await videoFieldsOf(service)) {
    for (const ref of filesOfVideo(field.source, options)) {
      // A remote ref by the path it encodes: `--fix` uploads a poster and
      // leaves the file where it was, exactly as it does a set's entry, and
      // that file is the field's — not something the set forgot.
      files.add(galleryEntryOf(ref).localPath);
    }
  }
  return files;
}

/**
 * The patches that point every `s.video(set)` field at a set entry's new key.
 *
 * One `add` on each field's `path`, so the description, poster, times and
 * captions beside it are never rewritten. A field of another set, or of no
 * set, is left alone even when its path is the same string: it names its own
 * file.
 */
export async function videosetReferencePatches(
  service: VideoFieldService,
  setModuleFilePath: ModuleFilePath,
  renamed: Record<string, string>,
): Promise<ModulePatch[]> {
  const byModule = new Map<ModuleFilePath, Patch>();
  for (const field of await videoFieldsOf(service)) {
    if (field.schema.referencedModule !== setModuleFilePath) {
      continue;
    }
    const value: unknown = field.source;
    const current = isRecord(value) ? value.path : undefined;
    if (typeof current !== "string" || !(current in renamed)) {
      continue;
    }
    const patch = byModule.get(field.moduleFilePath) ?? [];
    patch.push({
      op: "add",
      path: patchPathOf(field.sourcePath).concat("path"),
      value: renamed[current],
    });
    byModule.set(field.moduleFilePath, patch);
  }
  return [...byModule].map(([moduleFilePath, patch]) => ({
    moduleFilePath,
    patch,
  }));
}

/** The record at `sourcePath` and its entries, or why it could not be read. */
function resolveVideoset(
  module: { source?: Source; schema?: SerializedSchema },
  sourcePath: SourcePath,
):
  | {
      success: true;
      record: SerializedRecordSchema;
      entries: Record<string, unknown>;
    }
  | { success: false; errorMessage: string } {
  if (module.source === undefined || !module.schema) {
    return {
      success: false,
      errorMessage: `Could not resolve source or schema for ${sourcePath}`,
    };
  }
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(sourcePath);
  const resolved = Internal.resolvePath(
    modulePath,
    module.source,
    module.schema,
  );
  if (
    resolved.schema?.type !== "record" ||
    resolved.schema.mediaType !== "videos"
  ) {
    return {
      success: false,
      errorMessage: `Expected a video set at ${sourcePath}, got ${
        resolved.schema?.type ?? "nothing"
      }`,
    };
  }
  return {
    success: true,
    record: resolved.schema,
    entries: isRecord(resolved.source) ? resolved.source : {},
  };
}

/**
 * `videos:add-metadata`: the entry's KEY is its file, and it must be on disk
 * (or on Val Remote, read over HTTP) and a kind Val can read the size and
 * length of here — the same preconditions as `video:add-metadata`, asked of
 * the key instead of `path`.
 */
export async function handleVideosetMetadata(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  const key = entryKeyOf(ctx.sourcePath);
  if (key === undefined) {
    return {
      success: false,
      errorMessage: `Expected a video set entry at ${ctx.sourcePath}`,
    };
  }
  const absolute = path.join(ctx.projectRoot, key);
  if (!galleryEntryOf(key).remote && !ctx.fs.fileExists(absolute)) {
    return { success: false, errorMessage: `File ${absolute} does not exist` };
  }
  const entry = ctx.validationError.value;
  const missing = ["width", "height", "duration"].filter(
    (field) => !isRecord(entry) || entry[field] === undefined,
  );
  if (missing.length > 0 && !canReadVideoMetadata(key)) {
    return {
      success: false,
      errorMessage: unreadableVideoMetadataMessage(key, missing),
    };
  }
  return { success: true, shouldApplyPatch: true };
}

/**
 * `videos:check-remote`: a key that is wrong as a key — a remote URL in a set
 * that is not `.remote()`, one that does not parse, one outside the set's
 * directory. There is nothing to look up and nothing to move, so the error is
 * reported as it is, for a person: only they know which of the set's options
 * or the key is the mistake.
 */
export async function handleVideosetCheckRemote(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  return { success: false, errorMessage: ctx.validationError.message };
}

/**
 * `videos:upload-remote`: an entry of a `.remote()` set still keyed by a local
 * path. Every file it holds goes up — a stream bottom-up, as the Studio places
 * one — and `createFixPatch` renames the key to the ref, the same way
 * `images:upload-remote` does. The fields that name the entry by its old key
 * are rewritten too: without that they name a video the set no longer has.
 *
 * The entry's poster and captions — its defaults' files — go up with it, and
 * are what is left to do for an entry whose key is already remote: the key
 * stays, and the entry is written back with their refs.
 */
export async function handleVideosetUploadRemote(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  if (!ctx.fix) {
    return {
      success: false,
      // No sourcePath in the message: the reported location already points at it.
      errorMessage: `Video needs to be uploaded to Val Remote (use --fix to upload)`,
    };
  }
  const key = ctx.validationError.value;
  if (typeof key !== "string") {
    return {
      success: false,
      errorMessage: `Expected a local file path for the video set entry at ${ctx.sourcePath}`,
    };
  }
  if (ctx.remoteFiles[ctx.sourcePath]) {
    return {
      success: true,
      shouldApplyPatch: true,
      events: [{ type: "remote-already-uploaded", filePath: key }],
    };
  }
  const set = resolveVideoset(
    ctx.valModule,
    Internal.parentOfSourcePath(ctx.sourcePath),
  );
  if (!set.success) {
    return set;
  }
  const entry = set.entries[key];
  if (!isRecord(entry)) {
    return {
      success: false,
      errorMessage: `The video set has no entry '${key}' at ${ctx.sourcePath}`,
    };
  }
  // The key is local (the entry goes up whole), or the key is already on the
  // content host and only the entry's poster or captions are still here.
  const keyIsLocal = !Internal.isRemoteMediaPath(key);
  const entryFiles = localFilesOfEntry(entry);
  const missing = firstMissingVideoFile(ctx, [
    ...(keyIsLocal
      ? [
          {
            path: key,
            ...(typeof entry.mimeType === "string"
              ? { mimeType: entry.mimeType }
              : {}),
          },
        ]
      : []),
    ...entryFiles.map((file) => ({ path: file.path })),
  ]);
  if (missing !== undefined) {
    return { success: false, errorMessage: `File ${missing} does not exist` };
  }

  const opened = await openRemoteUploadSession(ctx);
  if (!opened.success) {
    return opened.result;
  }
  const { session } = opened;
  const uploader = createVideoUploader(
    ctx,
    session,
    videosetEntryVideoSchema(set.record),
    (localRef, role) => metadataOf(localRef, role, entry),
  );
  let ref: string;
  try {
    ref = keyIsLocal ? await uploader.put(key, "video") : key;
    for (const file of entryFiles) {
      await uploader.put(file.path, file.role);
    }
  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
  ctx.remoteFiles[ctx.sourcePath] = {
    ref,
    metadata: withMovedFiles(entry, uploader.moved),
    refs: Object.fromEntries(uploader.moved),
  };
  const otherModulePatches =
    ref === key
      ? []
      : await videosetReferencePatches(ctx.service, ctx.moduleFilePath, {
          [key]: ref,
        });
  return {
    success: true,
    shouldApplyPatch: true,
    publicProjectId: session.publicProjectId,
    remoteFileBuckets: session.remoteFileBuckets,
    remoteFilesCounter: session.remoteFilesCounter,
    events: uploader.events,
    ...(otherModulePatches.length > 0 ? { otherModulePatches } : {}),
  };
}

/**
 * `videos:check-all-files`: the set's entries against its directory.
 *
 * What only this handler can answer is which untracked files are accounted
 * for ELSEWHERE — a poster or caption a video field names — because that needs
 * every module in the project. Those are fine. An untracked file that is not
 * a video and that no field names is for a person to look at, and is reported
 * here. Everything `--fix` can do something about — an entry whose file has
 * gone, a video in the directory the set does not list — is left to
 * `createFixPatch` (see {@link videosetCheckAllFilesPatch}), which reports it
 * per entry, or repairs it.
 */
export async function handleVideosetCheckAllFiles(
  ctx: FixHandlerContext,
): Promise<FixHandlerResult> {
  const value = ctx.validationError.value;
  const dir = isRecord(value) ? value.dir : undefined;
  if (typeof dir !== "string") {
    return {
      success: false,
      errorMessage: `Unexpected value in check-all-files for ${ctx.sourcePath}`,
    };
  }
  const set = resolveVideoset(ctx.valModule, ctx.sourcePath);
  if (!set.success) {
    return set;
  }
  const readFile = (absolute: string) => ctx.fs.readBuffer(absolute);
  const incompleteEntries = incompleteGalleryEntries({
    entryKeys: Object.keys(set.entries),
    projectRoot: ctx.projectRoot,
    fs: ctx.fs,
    filesOfEntry: (entry, key) =>
      filesOfVideosetEntry(entry, set.entries[key], {
        projectRoot: ctx.projectRoot,
        readFile,
      }),
  });
  const { untrackedFiles } = checkGalleryFiles({
    entryKeys: Object.keys(set.entries),
    dir,
    projectRoot: ctx.projectRoot,
    fs: ctx.fs,
    filesOfEntry: (entry, key) =>
      filesOfVideosetEntry(entry, set.entries[key], {
        projectRoot: ctx.projectRoot,
        readFile,
      }),
  });
  if (incompleteEntries.length > 0) {
    return {
      success: false,
      errorMessage: incompleteMessage(incompleteEntries),
    };
  }
  if (untrackedFiles.length === 0) {
    return { success: true, shouldApplyPatch: true };
  }
  const named = await filesNamedByVideoFields(ctx.service, {
    projectRoot: ctx.projectRoot,
    readFile,
  });
  const { others } = classifyUntrackedVideosetFiles({
    untracked: untrackedFiles.filter((file) => !named.has(file)),
    accept: set.record.accept ?? "video/*",
    projectRoot: ctx.projectRoot,
    readFile,
  });
  if (others.length > 0) {
    return {
      success: false,
      errorMessage: `Video set in ${ctx.moduleFilePath} has files in '${dir}' that are not in the set, and that no video field uses: ${others.join(", ")}. They are not videos the set accepts, so --fix will not add them: move them out of the directory or remove them.`,
    };
  }
  return { success: true, shouldApplyPatch: true };
}

/**
 * The `createFixPatch` half of `videos:check-all-files`: drop the entries
 * whose file has gone, and add the videos in the directory that the set does
 * not list — with what is read from their bytes, or not at all.
 *
 * What is stored for an entry that IS on disk is not compared against its
 * bytes, unlike an image gallery's. The Studio reads a video's size and length
 * in the browser from the file as it was picked, and that is not what a header
 * parse of what is on disk says: a stream's largest rendition is not the
 * upload's size whenever the upload was larger than the largest rendition, and
 * two readers round a duration differently. Correcting one from the other
 * would rewrite every streamed video in the project, every run. A missing
 * value is `videos:add-metadata`'s, and is reported on the entry.
 */
export async function videosetCheckAllFilesPatch({
  projectRoot,
  apply,
  sourcePath,
  validationError,
  moduleSource,
  moduleSchema,
}: {
  projectRoot: string;
  apply: boolean;
  sourcePath: SourcePath;
  validationError: ValidationError;
  moduleSource: Source | undefined;
  moduleSchema: SerializedSchema | undefined;
}): Promise<{ patch: Patch; remainingErrors: FixPatchRemainingError[] }> {
  const patch: Patch = [];
  const remainingErrors: FixPatchRemainingError[] = [];
  const fail = (message: string) => ({
    patch,
    remainingErrors: [{ ...validationError, message, fixes: undefined }],
  });
  const value = validationError.value;
  const dir = isRecord(value) ? value.dir : undefined;
  if (typeof dir !== "string") {
    return fail(`Unexpected value in check-all-files for ${sourcePath}`);
  }
  if (moduleSource === undefined || moduleSchema === undefined) {
    return fail(
      "Unexpected error while checking a video set (no module source or schema)",
    );
  }
  const set = resolveVideoset(
    { source: moduleSource, schema: moduleSchema },
    sourcePath,
  );
  if (!set.success) {
    return fail(set.errorMessage);
  }
  const recordPath = patchPathOf(sourcePath);
  const incompleteEntries = incompleteGalleryEntries({
    entryKeys: Object.keys(set.entries),
    projectRoot,
    fs: ts.sys,
    filesOfEntry: (entry, key) =>
      filesOfVideosetEntry(entry, set.entries[key], { projectRoot }),
  });
  const { missingTrackedFiles, untrackedFiles } = checkGalleryFiles({
    entryKeys: Object.keys(set.entries),
    dir,
    projectRoot,
    // The host `createDefaultValFSHost` gives the handlers, and so the same
    // listing the handler half of this check saw.
    fs: ts.sys,
    filesOfEntry: (entry, key) =>
      filesOfVideosetEntry(entry, set.entries[key], { projectRoot }),
  });

  if (incompleteEntries.length > 0) {
    remainingErrors.push({
      ...validationError,
      message: incompleteMessage(incompleteEntries),
      fixes: undefined,
    });
  }

  for (const missing of missingTrackedFiles) {
    if (apply) {
      const removePath = recordPath.concat(missing);
      if (isNotRoot(removePath)) {
        patch.push({ op: "remove", path: removePath });
      }
    } else {
      remainingErrors.push({
        ...validationError,
        message: `Video '${missing}' is in the set, but its file does not exist. Use --fix to remove it from the set.`,
        sourcePath: Internal.createValPathOfItem(sourcePath, missing),
        keyError: true,
      });
    }
  }

  const { videos } = classifyUntrackedVideosetFiles({
    untracked: untrackedFiles,
    accept: set.record.accept ?? "video/*",
    projectRoot,
  });
  for (const file of videos) {
    let metadata: VideoMetadata;
    try {
      metadata = await extractVideoMetadataFromFile(
        path.join(projectRoot, file),
      );
    } catch (err) {
      remainingErrors.push({
        ...validationError,
        message: `Video '${file}' is in '${dir}' but not in the set, and its metadata could not be read: ${
          err instanceof Error ? err.message : String(err)
        }`,
        fixes: undefined,
      });
      continue;
    }
    const unreadable = VIDEO_METADATA_FIELDS.filter(
      (field) => metadata[field] === undefined,
    );
    if (unreadable.length > 0) {
      // All or nothing, as for `video:add-metadata`: an entry with a mime type
      // and no size is no closer to valid, and reads as one someone finished.
      remainingErrors.push({
        ...validationError,
        message: `Video '${file}' is in '${dir}' but not in the set. ${unreadableVideoMetadataMessage(
          file,
          unreadable,
        )}`,
        fixes: undefined,
      });
      continue;
    }
    if (!apply) {
      remainingErrors.push({
        ...validationError,
        message: `Video '${file}' is in '${dir}' but not in the set. Use --fix to add it.`,
      });
      continue;
    }
    const entry: Record<string, JSONValue> = {};
    for (const field of VIDEO_METADATA_FIELDS) {
      const read = metadata[field];
      if (read !== undefined) {
        entry[field] = read;
      }
    }
    // What an upload writes when nobody has described the video yet.
    entry.alt = null;
    const addPath = recordPath.concat(file);
    if (isNotRoot(addPath)) {
      patch.push({ op: "add", path: addPath, value: entry });
    }
  }
  return { patch, remainingErrors };
}

/**
 * The `createFixPatch` half of `videos:add-metadata`: read what is missing
 * from the file at the entry's KEY, and write only that, one op per field —
 * `alt` and anything already there are someone's, and stay.
 */
export async function videosetAddMetadataPatch({
  files,
  sourcePath,
  validationError,
  moduleSource,
  moduleSchema,
}: {
  files: FixFiles;
  sourcePath: SourcePath;
  validationError: ValidationError;
  moduleSource: Source | undefined;
  moduleSchema: SerializedSchema | undefined;
}): Promise<{ patch: Patch; remainingErrors: FixPatchRemainingError[] }> {
  const fail = (message: string) => ({
    patch: [],
    remainingErrors: [{ ...validationError, message, fixes: undefined }],
  });
  const key = entryKeyOf(sourcePath);
  if (key === undefined) {
    return fail(`Expected a video set entry at ${sourcePath}`);
  }
  let current: unknown = validationError.value;
  if (moduleSource !== undefined && moduleSchema !== undefined) {
    const parent = resolveVideoset(
      { source: moduleSource, schema: moduleSchema },
      Internal.parentOfSourcePath(sourcePath),
    );
    if (!parent.success) {
      return fail(`Could not add video metadata: ${parent.errorMessage}`);
    }
    current = parent.entries[key];
  }
  if (!isRecord(current)) {
    return fail("Video set entry is not an object!");
  }
  let metadata: VideoMetadata;
  try {
    metadata = galleryEntryOf(key).remote
      ? await extractVideoMetadataFromUrl(key, nameForTypeOf(key))
      : await files.readVideoMetadata(key);
  } catch (err) {
    return fail(
      `Failed to read video metadata from ${key}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const entry = current;
  const missing = VIDEO_METADATA_FIELDS.filter(
    (field) => entry[field] === undefined,
  );
  const unreadable = missing.filter((field) => metadata[field] === undefined);
  if (unreadable.length > 0) {
    return fail(unreadableVideoMetadataMessage(key, unreadable));
  }
  const entryPath = patchPathOf(sourcePath);
  const patch: Patch = [];
  for (const field of missing) {
    const read = metadata[field];
    if (read !== undefined) {
      patch.push({ op: "add", path: entryPath.concat(field), value: read });
    }
  }
  return { patch, remainingErrors: [] };
}

/**
 * What to say about streams whose master is there and some of whose files are
 * not. Not fixable: the entry still names a video someone uploaded, and only
 * they have the rest of it.
 */
function incompleteMessage(
  incomplete: { key: string; missing: string[] }[],
): string {
  return incomplete
    .map(
      ({ key, missing }) =>
        `Video '${key}' is missing ${missing.length === 1 ? "a file it names" : `${missing.length} files it names`}: ${missing.join(", ")}. It stops playing where they are. Upload it again, or put the files back.`,
    )
    .join(" ");
}
