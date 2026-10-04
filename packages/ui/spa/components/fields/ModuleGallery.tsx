import * as React from "react";
import {
  DEFAULT_VIDEO_ACCEPT,
  FileMetadata,
  ImageMetadata,
  Internal,
  SerializedFileSchema,
  SerializedImageSchema,
  SerializedVideoSchema,
  SourcePath,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue, Patch } from "@valbuild/core/patch";
import {
  useAddPatch,
  useFilePatchIds,
  useSchemaAtPath,
  useSourceAtPath,
  useValConfig,
} from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValRemoteProvider";
import {
  usePendingPatchesForModule,
  useProfilesByAuthorId,
} from "../ValProvider";
import { useAllValidationErrors } from "../ValErrorProvider";
import { sourcePathOfItem } from "../../utils/sourcePathOfItem";
import type { PendingPatch } from "../ValProvider";
import { getRefParts } from "@valbuild/shared/internal";
import { FieldLoading } from "../FieldLoading";
import { Progress } from "../designSystem/progress";
import { MediaGallery } from "../MediaGallery/MediaGallery";
import type { MediaItem, MediaKind, MediaUpload } from "../MediaGallery/types";
import { useNavigation } from "../ValRouter";
import { GalleryEntryInspector } from "./GalleryEntryInspector";
import { filesOfChoices, toPosterUpload } from "./VideoChoices";
import { captureFrame, defaultPosterTime } from "../../utils/video/readVideo";
import { useRenameMediaFile } from "../useRenameMediaFile";
import { readImage, readImageFromFile } from "../../utils/readImage";
import type { ReadImageEncode } from "../../utils/readImage";
import { resolveEncodeSettings } from "../../utils/encodeImage";
import { readFile, readFileFromFile } from "../../utils/readFile";
import { getFileExt } from "../../utils/getFileExt";
import { refToUrl } from "../MediaPicker/refToUrl";
import { useUploadRequest } from "../UploadRequest";
import { useRenameStreamEntry } from "../useRenameStreamEntry";
import {
  prepareVideoUpload,
  type PreparePhase,
} from "../../utils/video/prepareVideoUpload";
import {
  createVideosetEntryPatch,
  localPathOf,
} from "../../utils/video/createVideoPatch";
import { isPlaylistPath } from "../../utils/video/hlsPlaylist";
import { readStream } from "../../utils/video/renameVideo";
import { fetchStreamFile } from "../../utils/video/fetchStreamFile";

const textEncoder = new TextEncoder();

export function ModuleGallery({
  path,
  showChildPath: showChild,
  readonly,
}: {
  path: SourcePath;
  showChildPath?: SourcePath;
  /**
   * `s.imageset().readonly()` — look, do not touch.
   *
   * The gallery had no notion of it at all, so a readonly module still offered
   * upload, delete and alt text, and every one of them wrote a patch. The three
   * handlers are simply withheld: `FileGallery` already hides an action it was
   * given no handler for, which is better than a disabled button that invites a
   * click and then explains itself.
   */
  readonly?: boolean;
}) {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  const source = useSourceAtPath(path);
  const schemaAtPath = useSchemaAtPath(path);
  const filePatchIds = useFilePatchIds();
  const { addPatch, patchPath, addAndUploadPatchWithFileOps } =
    useAddPatch(path);
  const allModulePatches = usePendingPatchesForModule(moduleFilePath);
  const profilesByAuthorIds = useProfilesByAuthorId();
  const allValidationErrors = useAllValidationErrors() || {};

  const config = useValConfig();
  const remoteFiles = useRemoteFiles();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();

  const navigation = useNavigation();
  const inputRef = React.useRef<HTMLInputElement>(null);
  /**
   * The Media panel can ask this gallery to open its file dialog.
   *
   * The panel knows which gallery you meant; only this component knows how to
   * upload into one — the ref from the hash and the directory, local or remote,
   * the metadata entry and the file op as one patch. So the panel asks and this
   * answers, rather than the upload existing twice.
   */
  useUploadRequest(moduleFilePath, () => inputRef.current?.click());
  const dragCounterRef = React.useRef(0);
  const [isDraggingOver, setIsDraggingOver] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  /** The name of the file going up, for its tile. */
  const [uploadingName, setUploadingName] = React.useState<string | null>(null);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const [progressPercentage, setProgressPercentage] = React.useState<
    number | null
  >(null);
  /** Reading or converting a video, before its bytes start going up. */
  const [videoPhase, setVideoPhase] = React.useState<PreparePhase | null>(null);
  /** A stream was asked for and could not be made here; said, not failed. */
  const [uploadNotice, setUploadNotice] = React.useState<string | null>(null);

  const handleProgress = React.useCallback(
    (
      bytesUploaded: number,
      totalBytes: number,
      currentFile: number,
      totalFiles: number,
    ) => {
      const pct = Math.round(
        ((currentFile * totalBytes + bytesUploaded) /
          (totalFiles * totalBytes)) *
          100,
      );
      setProgressPercentage(pct);
      if (pct === 100) {
        setTimeout(() => {
          setProgressPercentage(null);
        }, 1000);
      }
    },
    [],
  );

  const rawSource =
    source.status === "success"
      ? (source.data as Record<string, Record<string, unknown>> | null)
      : null;

  const schema =
    schemaAtPath.status === "success" && schemaAtPath.data.type === "record"
      ? schemaAtPath.data
      : null;

  const imageMode = schema?.mediaType === "images";
  const videoMode = schema?.mediaType === "videos";
  const directory = schema?.dir ?? "/public/val";
  const accept = schema?.accept;
  /**
   * A gallery has no field to override it, so the gallery's own option is the
   * whole answer. Passed to both upload paths: the file input and the drop
   * loop are separate code, and a fix to one has never reached the other.
   */
  const encode = React.useMemo<ReadImageEncode>(
    () => ({
      settings: resolveEncodeSettings(undefined, schema?.encode),
      accept,
    }),
    [schema, accept],
  );

  const requireRemote = schema?.remote;
  const remoteData =
    schema?.remote &&
    remoteFiles.status === "ready" &&
    currentRemoteFileBucket &&
    config
      ? {
          publicProjectId: remoteFiles.publicProjectId,
          bucket: currentRemoteFileBucket,
          coreVersion: remoteFiles.coreVersion,
          remoteHost: config.remoteHost,
        }
      : null;

  /**
   * Whether an upload can succeed RIGHT NOW.
   *
   * A remote gallery cannot upload until `/remote/settings` has answered and a
   * bucket has been picked from it - which is several async hops after intake:
   * schemas arrive, that sets `requiresRemoteFiles`, that fires the request, and
   * `useCurrentRemoteFileBucket` picks a bucket in an effect after the response.
   * Until then `remoteData` is null and `handleUpload` can only refuse.
   *
   * Exposed so the button is not offered before it can work. It is also the only
   * signal anything outside this component can wait on - `remoteFiles` and the
   * bucket are both context state with no DOM of their own - which is what
   * `e2e/http/remoteFiles.spec.ts` waits for instead of racing the request.
   */
  const canUpload = !requireRemote || remoteData !== null;
  /** Loading is transient and about to resolve; inactive is a real failure. */
  const remoteSettingsPending =
    requireRemote === true &&
    (remoteFiles.status === "loading" || remoteFiles.status === "not-asked");

  /**
   * What a video's remote validation hash is computed from: the same
   * synthesized schema `val validate --fix` uploads a set's videos with, or
   * the two would name the same file by two refs.
   */
  const videoSchema = React.useMemo<SerializedVideoSchema>(
    () => Internal.videosetEntryVideoSchema({ accept, dir: schema?.dir }),
    [accept, schema],
  );

  /** A file's URL, including while it is a draft. */
  const urlOf = React.useCallback(
    (media: { path: string; patch_id?: string }) => {
      const patchId = filePatchIds.get(media.path) ?? media.patch_id;
      return Internal.mediaUrl({
        path: media.path,
        ...(patchId ? { patch_id: patchId } : {}),
      });
    },
    [filePatchIds],
  );

  const kind: MediaKind = videoMode ? "videos" : imageMode ? "images" : "files";
  /** Who changed each entry, by its key: for the panel's authors and Compare. */
  const patchesByRef: Record<string, Record<string, PendingPatch[]>> = {};
  const items: MediaItem[] = rawSource
    ? Object.entries(rawSource).map(([ref, meta]) => {
        const mimeType = typeof meta.mimeType === "string" ? meta.mimeType : "";
        const hotspot =
          typeof meta.hotspot === "object" &&
          meta.hotspot !== null &&
          "x" in meta.hotspot &&
          "y" in meta.hotspot &&
          typeof meta.hotspot.x === "number" &&
          typeof meta.hotspot.y === "number"
            ? { x: meta.hotspot.x, y: meta.hotspot.y }
            : undefined;
        const poster =
          typeof meta.poster === "object" &&
          meta.poster !== null &&
          "path" in meta.poster &&
          typeof meta.poster.path === "string"
            ? {
                path: meta.poster.path,
                ...("patch_id" in meta.poster &&
                typeof meta.poster.patch_id === "string"
                  ? { patch_id: meta.poster.patch_id }
                  : {}),
              }
            : undefined;
        const itemPath = sourcePathOfItem(path, ref);
        const errors: string[] = [];
        const descriptionErrors: string[] = [];
        for (const [errPath, errs] of Object.entries(allValidationErrors)) {
          if (!errPath.startsWith(itemPath)) {
            continue;
          }
          if (errPath === Internal.createValPathOfItem(itemPath, "alt")) {
            descriptionErrors.push(...errs.map((err) => err.message));
          } else {
            errors.push(...errs.map((err) => err.message));
          }
        }

        /*
         * At the entry OR INSIDE it. Only an exact match counted once, so a
         * file whose alt text was edited — a patch at `[ref, "alt"]`, the
         * commonest change a gallery gets — showed no authors and no Compare
         * link, as though nothing about it had changed.
         */
        const filePatchPath = [...patchPath, ref];
        const byAuthor: Record<string, PendingPatch[]> = {};
        for (const patch of allModulePatches) {
          if (
            !patch.patch.some((op) => isPatchPathWithin(op.path, filePatchPath))
          ) {
            continue;
          }
          const author = patch.authorId ?? "unknown";
          (byAuthor[author] ??= []).push(patch);
        }
        patchesByRef[ref] = byAuthor;

        // A stream is named by its directory: every master is `master.m3u8`,
        // and the directory is what a rename renames.
        const isHls = videoMode && isPlaylistPath(localPathOf(ref));
        const { filename, folder } = isHls
          ? getRefParts(
              localPathOf(ref).slice(0, localPathOf(ref).lastIndexOf("/")),
            )
          : getRefParts(ref);

        return {
          ref,
          url: refToUrl(ref, filePatchIds),
          name: filename,
          folder,
          mimeType,
          ...(typeof meta.width === "number" ? { width: meta.width } : {}),
          ...(typeof meta.height === "number" ? { height: meta.height } : {}),
          ...(typeof meta.duration === "number"
            ? { duration: meta.duration }
            : {}),
          description: typeof meta.alt === "string" ? meta.alt : null,
          ...(hotspot ? { hotspot } : {}),
          // The entry's poster is its thumbnail: one still per video.
          ...(poster ? { thumbnailUrl: urlOf(poster) } : {}),
          ...(isHls ? { isHls } : {}),
          ...(errors.length > 0 ? { errors } : {}),
          ...(descriptionErrors.length > 0 ? { descriptionErrors } : {}),
        };
      })
    : [];

  const deleteEntry = React.useCallback(
    (ref: string) => {
      if (!rawSource || !(ref in rawSource)) return;
      const isRemoteRef =
        Internal.remote.splitRemoteRef(ref).status === "success";
      setUploading(true);
      (async () => {
        let filePaths = [ref];
        if (videoMode && !isRemoteRef && isPlaylistPath(localPathOf(ref))) {
          // A local stream is a directory of files, and they all go: the
          // master alone would leave every playlist and segment behind it.
          try {
            const files = await readStream(
              ref,
              refToUrl(ref, filePatchIds),
              fetchStreamFile,
              window.location.href,
            );
            const directory = ref.slice(0, ref.lastIndexOf("/"));
            filePaths = Object.keys(files).map(
              (name) => `${directory}/${name}`,
            );
          } catch (err) {
            // A stream that cannot be read is still one that can be removed;
            // what is left behind, `val validate` reports as untracked.
            console.warn("Val: could not list the stream's files", err);
          }
        }
        // The entry's own poster and captions go with it: they are the
        // set's files, named by nothing else (a field using the entry blocks
        // the delete before it gets here).
        const entryFiles = videoMode ? filesOfChoices(rawSource[ref]) : [];
        const patch: Patch = [
          {
            op: "remove",
            path: [...patchPath, ref] as unknown as array.NonEmptyArray<string>,
          },
          ...filePaths.map((filePath): Patch[number] => ({
            op: "file",
            path: [...patchPath, ref],
            filePath,
            value: null,
            remote: isRemoteRef,
          })),
          ...entryFiles.map((filePath): Patch[number] => ({
            op: "file",
            path: [...patchPath, ref],
            filePath,
            value: null,
            remote: Internal.isRemoteMediaPath(filePath),
          })),
        ];
        await addAndUploadPatchWithFileOps(
          patch,
          imageMode ? "image" : "file",
          (msg) => setUploadError(msg),
          () => {},
        );
      })().finally(() => setUploading(false));
    },
    [
      rawSource,
      patchPath,
      imageMode,
      videoMode,
      filePatchIds,
      addAndUploadPatchWithFileOps,
    ],
  );

  const renameMediaFile = useRenameMediaFile(path);
  const renameStreamEntry = useRenameStreamEntry(path);
  /**
   * Rename the entry `ref` to `newBase`; resolves to a message to show, or
   * null. The panel follows the file to its new key: the old one is gone, and
   * so is the URL that named it.
   */
  const renameEntry = React.useCallback(
    async (ref: string, newBase: string): Promise<string | null> => {
      if (!rawSource) {
        return "The gallery has not loaded.";
      }
      const meta = rawSource[ref];
      if (meta === undefined) {
        return "That file is no longer here.";
      }
      const mimeType =
        typeof meta.mimeType === "string" ? meta.mimeType : undefined;
      // A stream is a directory, and the directory is its name: every file
      // in it moves. See `renameVideo.ts`.
      const res =
        videoMode && isPlaylistPath(localPathOf(ref))
          ? await renameStreamEntry({
              key: ref,
              newBase,
              url: refToUrl(ref, filePatchIds),
              existingKeys: Object.keys(rawSource),
              schema: videoSchema,
            })
          : await renameMediaFile({
              kind: "gallery-entry",
              key: ref,
              newBase,
              metadata:
                mimeType === undefined
                  ? undefined
                  : imageMode &&
                      typeof meta.width === "number" &&
                      typeof meta.height === "number"
                    ? { mimeType, width: meta.width, height: meta.height }
                    : { mimeType },
              fileType: imageMode ? "image" : "file",
            });
      if (res.status === "ok" || res.status === "partial") {
        const childPath = Internal.createValPathOfItem(
          moduleFilePath as string as SourcePath,
          res.newPath,
        );
        if (childPath) {
          navigation.navigate(childPath, { replace: true });
        }
        return res.status === "partial" ? res.message : null;
      }
      return res.status === "error" ? res.message : null;
    },
    [
      rawSource,
      imageMode,
      videoMode,
      renameMediaFile,
      renameStreamEntry,
      filePatchIds,
      videoSchema,
      moduleFilePath,
      navigation,
    ],
  );

  const setDescription = React.useCallback(
    (ref: string, newAltText: string) => {
      if (!rawSource || !(ref in rawSource)) return;
      const patch: Patch = [
        {
          // "add", not "replace": on an object key the two mean the same thing,
          // but "add" also works when the key is absent by the time the patch is
          // applied - e.g. the entry was re-uploaded with fresh metadata.
          op: "add",
          path: [...patchPath, ref, "alt"],
          value: newAltText,
        },
      ];
      addPatch(patch, "record");
    },
    [rawSource, patchPath, addPatch],
  );

  /**
   * One video into the set: read, converted to a stream when the set asks
   * and this browser can, and uploaded as the entry and its files. The same
   * step a video field takes (`prepareVideoUpload`), with the patch naming a
   * set entry instead of a field.
   */
  const uploadVideo = React.useCallback(
    async (file: File) => {
      const objectUrl = URL.createObjectURL(file);
      try {
        const prepared = await prepareVideoUpload(
          file,
          objectUrl,
          { accept: accept ?? DEFAULT_VIDEO_ACCEPT, stream: schema?.stream },
          setVideoPhase,
        );
        if (prepared.status === "error") {
          setUploadError(prepared.message);
          return;
        }
        if (prepared.notice) {
          setUploadNotice(prepared.notice);
        }
        // The entry's poster, from the file as it was picked: it is the
        // gallery's thumbnail, and a stream gives a tile nothing else.
        const posterTime = defaultPosterTime(prepared.metadata.duration);
        const poster = await captureFrame(objectUrl, posterTime)
          .then(toPosterUpload)
          .catch(() => null);
        const { patch } = createVideosetEntryPatch(
          {
            setPatchPath: patchPath,
            dir: directory,
            filename: file.name,
            upload: prepared.upload,
            metadata: prepared.metadata,
            remote: requireRemote ? remoteData : null,
            schema: videoSchema,
            poster: poster ? { upload: poster, time: posterTime } : null,
          },
          Internal.getSHA256Hash,
        );
        setVideoPhase(null);
        await addAndUploadPatchWithFileOps(
          patch,
          "file",
          (msg) => setUploadError(msg),
          handleProgress,
        );
      } catch (err) {
        console.error("Val: video upload failed", err);
        setUploadError(
          `Could not upload the video: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        URL.revokeObjectURL(objectUrl);
        setVideoPhase(null);
      }
    },
    [
      accept,
      schema,
      patchPath,
      directory,
      requireRemote,
      remoteData,
      videoSchema,
      addAndUploadPatchWithFileOps,
      handleProgress,
    ],
  );

  const computeRef = React.useCallback(
    (
      res: {
        fileHash: string;
        src: string;
        filename?: string;
      },
      syntheticSchema: SerializedImageSchema | SerializedFileSchema,
      metadata: Record<string, unknown> | undefined,
    ):
      | {
          status: "success";
          ref: string;
          isRemote: boolean;
        }
      | {
          status: "error";
          error: string;
        } => {
      const newFilename = Internal.createFilename(
        res.src,
        res.filename ?? null,
        metadata,
        res.fileHash,
      );
      if (!newFilename) {
        return {
          status: "error",
          error: "Failed to create filename for the uploaded file.",
        };
      }
      const filePath = `${directory}/${newFilename}`;
      let ref: string;
      let isRemote: boolean;
      if (requireRemote) {
        if (!remoteData) {
          return {
            status: "error",
            error:
              "Remote uploads are not available. Please try again later. This could be a temporary issue with the Val server. If the problem persists, please contact support.",
          };
        }
        const remoteFileHash = Internal.remote.hashToRemoteFileHash(
          res.fileHash,
        );
        const validationHash = Internal.remote.getValidationHash(
          remoteData.coreVersion,
          syntheticSchema,
          getFileExt(newFilename),
          metadata,
          remoteFileHash,
          textEncoder,
        );
        ref = Internal.remote.createRemoteRef(remoteData.remoteHost, {
          publicProjectId: remoteData.publicProjectId,
          coreVersion: remoteData.coreVersion,
          bucket: remoteData.bucket,
          validationHash,
          fileHash: remoteFileHash,
          filePath:
            `${directory.slice(1)}/${newFilename}` as `public/${string}`,
        });
        isRemote = true;
      } else {
        ref = filePath;
        isRemote = false;
      }
      return {
        status: "success",
        ref,
        isRemote,
      };
    },
    [directory, requireRemote, remoteData],
  );

  const handleUpload = React.useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      setUploadError(null);
      if (requireRemote && (!remoteData || !currentRemoteFileBucket)) {
        if (!currentRemoteFileBucket) {
          /**
           * Still loading is NOT the same as unavailable.
           *
           * Both used to land on "contact support", so an editor quick enough to
           * pick a file while `/remote/settings` was still in flight was told
           * their upload had failed permanently - for a state that resolves in
           * milliseconds. The button is disabled until `canUpload`, so this is
           * now only reachable by something that bypasses it (a drop, or a test
           * driving the hidden input), and it says what is actually true.
           */
          if (remoteSettingsPending) {
            setUploadError("Preparing remote uploads - try again in a moment.");
            ev.target.value = "";
            return;
          }
          console.error("Current remote file bucket is not available", {
            remoteFiles,
            currentRemoteFileBucket,
          });
          setUploadError(
            "Remote uploads are not available. Please try again later. Val server responded with result, but no remote file buckets were available. This could be a temporary issue with the Val server. If the problem persists, please contact support.",
          );
          ev.target.value = "";
          return;
        }
        setUploadError(
          "Remote uploads are not available. Please try again later.",
        );
        ev.target.value = "";
        return;
      }
      setUploadingName(ev.target.files?.[0]?.name ?? null);
      if (videoMode) {
        const file = ev.target.files?.[0];
        ev.target.value = "";
        if (!file) return;
        setUploadNotice(null);
        setUploading(true);
        uploadVideo(file).finally(() => {
          setUploading(false);
          setProgressPercentage(null);
        });
        return;
      }
      if (imageMode) {
        readImage(ev, encode)
          .then(async (res) => {
            if (!res.width || !res.height || !res.mimeType) return;
            const metadata: ImageMetadata = {
              width: res.width,
              height: res.height,
              mimeType: res.mimeType,
            };
            const refRes = computeRef(
              res,
              {
                type: "image",
                opt: false,
                options: schema?.accept ? { accept: schema.accept } : undefined,
              },
              metadata,
            );
            if (refRes.status === "error") {
              setUploadError(refRes.error);
              return;
            }
            const { ref, isRemote } = refRes;

            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, ref],
                value: {
                  width: metadata.width,
                  height: metadata.height,
                  mimeType: metadata.mimeType,
                  alt: null, // default alt for new uploads
                } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, ref],
                filePath: ref,
                value: res.src,
                metadata,
                remote: isRemote,
              },
            ];
            setUploading(true);
            await addAndUploadPatchWithFileOps(
              patch,
              "image",
              (msg) => setUploadError(msg),
              handleProgress,
            );
          })
          .catch(() =>
            setUploadError("Could not upload image. Please try again."),
          )
          .finally(() => {
            setUploading(false);
            setProgressPercentage(null);
          });
      } else {
        readFile(ev)
          .then(async (res) => {
            if (!res.mimeType) return;
            const metadata: FileMetadata = { mimeType: res.mimeType };
            const newFilename = Internal.createFilename(
              res.src,
              res.filename ?? null,
              metadata,
              res.fileHash,
            );
            if (!newFilename) return;
            const refRes = computeRef(
              res,
              {
                type: "file",
                opt: false,
                options: schema?.accept ? { accept: schema.accept } : undefined,
              },
              metadata,
            );
            if (refRes.status === "error") {
              setUploadError(refRes.error);
              return;
            }
            const { ref, isRemote } = refRes;
            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, ref],
                value: { mimeType: metadata.mimeType } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, ref],
                filePath: ref,
                value: res.src,
                metadata,
                remote: isRemote,
              },
            ];
            setUploading(true);
            await addAndUploadPatchWithFileOps(
              patch,
              "file",
              (msg) => setUploadError(msg),
              handleProgress,
            );
          })
          .catch(() =>
            setUploadError("Could not upload file. Please try again."),
          )
          .finally(() => {
            setUploading(false);
            setProgressPercentage(null);
          });
      }
      ev.target.value = "";
    },
    [
      imageMode,
      videoMode,
      uploadVideo,
      directory,
      patchPath,
      addAndUploadPatchWithFileOps,
      requireRemote,
      remoteData,
      currentRemoteFileBucket,
      schema,
      remoteFiles,
      encode,
      remoteSettingsPending,
    ],
  );

  const handleDrop = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);
      if (requireRemote && (!remoteData || !currentRemoteFileBucket)) {
        /**
         * Same distinction as `handleUpload`, and this is the path that needs
         * it most: a drop has no button to disable, so `canUpload` cannot keep
         * anyone out of here. Dropping a file while `/remote/settings` is still
         * in flight is the one way an editor can still meet this, and it is
         * transient - saying "not available" would be false.
         */
        setUploadError(
          remoteSettingsPending
            ? "Preparing remote uploads - try again in a moment."
            : "Remote uploads are not available. Please try again later.",
        );
        return;
      }
      const droppedFiles = Array.from(e.dataTransfer.files).filter((file) => {
        if (!accept) return true;
        return accept
          .split(",")
          .map((s) => s.trim())
          .some((pattern) => {
            if (pattern.endsWith("/*"))
              return file.type.startsWith(pattern.slice(0, -1));
            return file.type === pattern;
          });
      });
      if (droppedFiles.length === 0) return;
      setUploadError(null);
      setUploadNotice(null);
      setUploading(true);
      (async () => {
        for (const file of droppedFiles) {
          setUploadingName(file.name);
          if (videoMode) {
            await uploadVideo(file);
          } else if (imageMode) {
            const res = await readImageFromFile(file, encode).catch(() => null);
            if (!res || !res.width || !res.height || !res.mimeType) continue;
            const metadata: ImageMetadata = {
              width: res.width,
              height: res.height,
              mimeType: res.mimeType,
            };
            const refRes = computeRef(
              res,
              {
                type: "image",
                opt: false,
                options: schema?.accept ? { accept: schema.accept } : undefined,
              },
              metadata,
            );
            if (refRes.status === "error") {
              setUploadError(refRes.error);
              continue;
            }
            const { ref, isRemote } = refRes;
            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, ref],
                value: {
                  width: metadata.width,
                  height: metadata.height,
                  mimeType: metadata.mimeType,
                  alt: null,
                } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, ref],
                filePath: ref,
                value: res.src,
                metadata,
                remote: isRemote,
              },
            ];
            await addAndUploadPatchWithFileOps(
              patch,
              "image",
              (msg) => setUploadError(msg),
              handleProgress,
            );
          } else {
            const res = await readFileFromFile(file).catch(() => null);
            if (!res || !res.mimeType) continue;
            const metadata: FileMetadata = { mimeType: res.mimeType };
            const refRes = computeRef(
              res,
              {
                type: "file",
                opt: false,
                options: schema?.accept ? { accept: schema.accept } : undefined,
              },
              metadata,
            );
            if (refRes.status === "error") {
              setUploadError(refRes.error);
              continue;
            }
            const { ref, isRemote } = refRes;
            const patch: Patch = [
              {
                op: "add",
                path: [...patchPath, ref],
                value: { mimeType: metadata.mimeType } as JSONValue,
              },
              {
                op: "file",
                path: [...patchPath, ref],
                filePath: ref,
                value: res.src,
                metadata,
                remote: isRemote,
              },
            ];
            await addAndUploadPatchWithFileOps(
              patch,
              "file",
              (msg) => setUploadError(msg),
              handleProgress,
            );
          }
        }
      })().finally(() => {
        setUploading(false);
        setProgressPercentage(null);
      });
    },
    [
      imageMode,
      videoMode,
      uploadVideo,
      patchPath,
      addAndUploadPatchWithFileOps,
      requireRemote,
      remoteData,
      currentRemoteFileBucket,
      accept,
      schema,
      computeRef,
      handleProgress,
      encode,
      // Derived from `remoteFiles`, which is NOT otherwise a dependency here.
      // On loading -> inactive neither `remoteData` nor the bucket changes
      // (both stay null), so without this the flag stays stale at `true` and a
      // genuinely unavailable remote would keep saying "try again in a moment".
      remoteSettingsPending,
    ],
  );

  /** The upload in flight, as a tile where it will land. */
  const uploads: MediaUpload[] = uploading
    ? [
        {
          id: "upload",
          name: uploadingName ?? "Uploading",
          phase:
            videoPhase?.kind === "reading"
              ? "reading"
              : videoPhase?.kind === "converting"
                ? "converting"
                : "uploading",
          progress:
            videoPhase?.kind === "converting"
              ? videoPhase.progress
              : videoPhase?.kind === "reading"
                ? null
                : progressPercentage,
        },
      ]
    : [];

  const showChildRef = React.useMemo(() => {
    if (!showChild) return null;
    const [, modulePath] = Internal.splitModuleFilePathAndModulePath(showChild);
    const childKey = Internal.splitModulePath(modulePath)[0];
    if (typeof childKey !== "string") return null;
    return childKey;
  }, [showChild]);

  if (source.status !== "success") {
    return <FieldLoading path={path} type="record" />;
  }

  return (
    <div
      id={path}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounterRef.current++;
        setIsDraggingOver(true);
      }}
      onDragLeave={() => {
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) setIsDraggingOver(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {uploadError && (
        <div className="mb-2 rounded p-3 bg-bg-error-primary text-fg-error-primary text-sm">
          {uploadError}
        </div>
      )}
      {uploadNotice && (
        <p role="status" className="mb-2 text-xs text-fg-secondary">
          {uploadNotice}
        </p>
      )}
      {videoPhase && (
        <p role="status" className="mb-2 text-xs text-fg-secondary">
          {videoPhase.kind === "reading"
            ? "Reading the video…"
            : `Converting to a stream… ${videoPhase.progress}%`}
        </p>
      )}
      {progressPercentage === null ? (
        <div className="h-[2px] mb-2" />
      ) : (
        <Progress
          className="h-[2px] mb-2 transition-opacity duration-300 z-[1000]"
          style={{ opacity: 1 }}
          value={progressPercentage ?? 0}
        />
      )}
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={accept}
        onChange={handleUpload}
      />
      <MediaGallery
        kind={kind}
        items={items}
        uploads={uploads}
        uploading={uploading}
        selectedRef={showChildRef}
        onSelect={(ref) => {
          const target =
            ref === null
              ? (moduleFilePath as string as SourcePath)
              : Internal.createValPathOfItem(
                  moduleFilePath as string as SourcePath,
                  ref,
                );
          if (target) {
            navigation.navigate(target);
          }
        }}
        onUploadClick={readonly ? undefined : () => inputRef.current?.click()}
        uploadDisabled={!canUpload}
        isDraggingOver={isDraggingOver}
        readonly={readonly}
        renderInspector={(item, close) => (
          <GalleryEntryInspector
            key={item.ref}
            kind={kind}
            item={item}
            entry={rawSource?.[item.ref]}
            entryPatchPath={[...patchPath, item.ref]}
            moduleFilePath={moduleFilePath}
            close={close}
            readonly={readonly}
            write={(patch) => addPatch(patch, "record")}
            onDescriptionChange={
              kind === "files" || readonly
                ? undefined
                : (text) => setDescription(item.ref, text)
            }
            onRename={
              readonly ? undefined : (newBase) => renameEntry(item.ref, newBase)
            }
            onDelete={
              readonly
                ? undefined
                : () => {
                    deleteEntry(item.ref);
                    close();
                  }
            }
            patchesByAuthorIds={patchesByRef[item.ref] ?? {}}
            profilesByAuthorIds={profilesByAuthorIds}
            video={
              videoMode
                ? {
                    dir: directory,
                    remote: requireRemote ? remoteData : null,
                    requireRemote: !!requireRemote,
                    schema: videoSchema,
                    upload: (patch) =>
                      addAndUploadPatchWithFileOps(
                        patch,
                        "file",
                        (msg) => setUploadError(msg),
                        () => {},
                      ),
                  }
                : null
            }
            urlOf={urlOf}
          />
        )}
      />
    </div>
  );
}

/** Whether `path` is `prefix` or a path inside it, segment by segment. */
function isPatchPathWithin(
  path: readonly string[],
  prefix: readonly string[],
): boolean {
  return (
    path.length >= prefix.length &&
    prefix.every((segment, i) => path[i] === segment)
  );
}
