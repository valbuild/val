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
import { getRefParts } from "@valbuild/shared/internal";
import { FieldLoading } from "../FieldLoading";
import { Progress } from "../designSystem/progress";
import { FileGallery } from "../FileGallery/FileGallery";
import type { FileRenameResult, GalleryFile } from "../FileGallery/types";
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
   * What a video's remote validation hash is computed from. A set has no
   * video schema of its own, so one is made of what it says — as the image
   * gallery does above for an image.
   */
  const videoSchema = React.useMemo<SerializedVideoSchema>(
    () => ({
      type: "video",
      opt: false,
      remote: !!requireRemote,
      options: accept ? { accept } : undefined,
    }),
    [requireRemote, accept],
  );

  const files: GalleryFile[] = rawSource
    ? Object.entries(rawSource).map(([ref, meta]) => {
        const mimeType = typeof meta.mimeType === "string" ? meta.mimeType : "";
        const width = typeof meta.width === "number" ? meta.width : 0;
        const height = typeof meta.height === "number" ? meta.height : 0;
        const alt = typeof meta.alt === "string" ? meta.alt : undefined;
        const duration =
          typeof meta.duration === "number" ? meta.duration : undefined;
        const hotspot =
          typeof meta.hotspot === "object" &&
          meta.hotspot !== null &&
          "x" in (meta.hotspot as Record<string, unknown>) &&
          "y" in (meta.hotspot as Record<string, unknown>) &&
          typeof (meta.hotspot as Record<string, unknown>).x === "number" &&
          typeof (meta.hotspot as Record<string, unknown>).y === "number"
            ? {
                x: (meta.hotspot as { x: number }).x,
                y: (meta.hotspot as { y: number }).y,
              }
            : undefined;
        const itemPath = sourcePathOfItem(path, ref);
        const genericValidationErrors = [];
        const altSpecificValidationErrors = [];
        for (const [errPath, errs] of Object.entries(allValidationErrors)) {
          if (!errPath.startsWith(itemPath)) {
            continue;
          }
          if (errPath === Internal.createValPathOfItem(itemPath, "alt")) {
            altSpecificValidationErrors.push(...errs.map((err) => err.message));
          } else {
            genericValidationErrors.push(...errs.map((err) => err.message));
          }
        }

        /*
         * At the entry OR INSIDE it. Only an exact match counted once, so a
         * file whose alt text was edited — a patch at `[ref, "alt"]`, the
         * commonest change a gallery gets — showed no authors and no Compare
         * link, as though nothing about it had changed.
         */
        const filePatchPath = [...patchPath, ref];
        const filePatches = allModulePatches.filter((patch) =>
          patch.patch.some((op) => isPatchPathWithin(op.path, filePatchPath)),
        );
        const filePatchesByAuthorIds: Record<
          string,
          (typeof allModulePatches)[number][]
        > = {};
        for (const patch of filePatches) {
          const author = patch.authorId ?? "unknown";
          if (!filePatchesByAuthorIds[author]) {
            filePatchesByAuthorIds[author] = [];
          }
          filePatchesByAuthorIds[author].push(patch);
        }

        // A stream is named by its directory: every master is `master.m3u8`,
        // and the directory is what a rename renames.
        const { filename, folder } =
          videoMode && isPlaylistPath(localPathOf(ref))
            ? getRefParts(
                localPathOf(ref).slice(0, localPathOf(ref).lastIndexOf("/")),
              )
            : getRefParts(ref);

        return {
          ref,
          url: refToUrl(ref, filePatchIds),
          filename,
          folder,
          metadata: { mimeType, width, height, alt, hotspot, duration },
          fieldSpecificErrors: {
            alt:
              altSpecificValidationErrors.length > 0
                ? altSpecificValidationErrors
                : undefined,
          },
          validationErrors:
            genericValidationErrors.length > 0
              ? genericValidationErrors
              : undefined,
          patchesByAuthorIds: filePatchesByAuthorIds,
          profilesByAuthorIds,
          sourcePath: itemPath,
        };
      })
    : [];

  const handleFileDelete = React.useCallback(
    (index: number) => {
      if (!rawSource) return;
      const ref = Object.keys(rawSource)[index];
      if (!ref) return;
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
  const handleFileRename = React.useCallback(
    async (
      index: number,
      _newFilename: string,
      newBase: string,
    ): Promise<FileRenameResult> => {
      if (!rawSource) {
        return { status: "error", message: "The gallery has not loaded." };
      }
      const ref = Object.keys(rawSource)[index];
      const meta = ref === undefined ? undefined : rawSource[ref];
      if (ref === undefined || meta === undefined) {
        return { status: "error", message: "That file is no longer here." };
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
      if (res.status === "ok") {
        return { status: "ok", newRef: res.newPath };
      }
      if (res.status === "partial") {
        return { status: "partial", newRef: res.newPath, message: res.message };
      }
      return res;
    },
    [
      rawSource,
      imageMode,
      videoMode,
      renameMediaFile,
      renameStreamEntry,
      filePatchIds,
      videoSchema,
    ],
  );

  const handleAltTextChange = React.useCallback(
    (index: number, newAltText: string) => {
      if (!rawSource) return;
      const ref = Object.keys(rawSource)[index];
      if (!ref) return;
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
        const { patch } = createVideosetEntryPatch(
          {
            setPatchPath: patchPath,
            dir: directory,
            filename: file.name,
            upload: prepared.upload,
            metadata: prepared.metadata,
            remote: requireRemote ? remoteData : null,
            schema: videoSchema,
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
      <FileGallery
        files={files}
        parentPath={moduleFilePath}
        imageMode={imageMode}
        videoMode={videoMode}
        onAltTextChange={
          (imageMode || videoMode) && !readonly
            ? handleAltTextChange
            : undefined
        }
        onFileDelete={readonly ? undefined : handleFileDelete}
        onFileRename={readonly ? undefined : handleFileRename}
        onUploadClick={readonly ? undefined : () => inputRef.current?.click()}
        uploadDisabled={!canUpload}
        uploading={uploading}
        defaultOpenFileRef={showChildRef ?? undefined}
        isDraggingOver={isDraggingOver}
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
