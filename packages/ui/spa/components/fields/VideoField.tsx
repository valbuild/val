import {
  DEFAULT_VIDEO_ACCEPT,
  Internal,
  ModuleFilePath,
  SourcePath,
  type SerializedVideoSchema,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { Film, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSchemaError } from "../FieldSchemaError";
import { FieldSchemaMismatchError } from "../FieldSchemaMismatchError";
import { FieldSourceError } from "../FieldSourceError";
import { PreviewLoading, PreviewNull } from "../Preview";
import {
  useFilePatchIds,
  useModuleSchema,
  useShallowSourceAtPath,
  useSourceAtPath,
  useValConfig,
  useValField,
} from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValRemoteProvider";
import { Button } from "../designSystem/button";
import { getRemoteFilesError } from "./remoteFilesError";
import { ImageCard } from "./ImageCard";
import { VideoPlayer } from "./VideoPlayer";
import {
  createSetBackedVideoPatch,
  createVideoPatch,
  localPathOf,
  type PosterUpload,
  type RemoteUploadConfig,
} from "../../utils/video/createVideoPatch";
import { captureFrame, defaultPosterTime } from "../../utils/video/readVideo";
import { prepareVideoUpload } from "../../utils/video/prepareVideoUpload";
import {
  buildStreamRenamePatch,
  readStream,
} from "../../utils/video/renameVideo";
import { fetchStreamFile } from "../../utils/video/fetchStreamFile";
import { RenameFileButton } from "./RenameFileButton";
import {
  effectiveChoices,
  formatTime,
  toPosterUpload,
  VideoChoices,
  videoChoicesOf,
  type VideoChoicesValue,
} from "./VideoChoices";
import { useValPortal } from "../ValPortalProvider";
import { ModuleMediaPicker } from "../MediaPicker/MediaPicker";
import type { GalleryEntry } from "../MediaPicker/MediaPicker";
import { prettyModuleName } from "../MediaPicker/GalleryUploadTarget";
import { cn } from "../designSystem/cn";
import { isJsonArray } from "../../utils/isJsonArray";

const type = "video";

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "converting"; progress: number }
  | { kind: "uploading"; progress: number };

export function VideoField({
  path,
  readonly,
  compact,
}: {
  path: SourcePath;
  readonly?: boolean;
  compact?: boolean;
}) {
  const config = useValConfig();
  const currentRemoteFileBucket = useCurrentRemoteFileBucket();
  const remoteFiles = useRemoteFiles();
  const filePatchIds = useFilePatchIds();
  const {
    source: sourceAtPath,
    schema: schemaAtPath,
    addPatch,
    patchPath,
    addAndUploadPatchWithFileOps,
    addModuleFilePatch,
  } = useValField(path, type);
  /**
   * The `s.videoset()` this field picks from, if it does. Read before the
   * early returns below so the hooks run in the same order every render.
   */
  const referencedModule =
    schemaAtPath.status === "success" && schemaAtPath.data.type === "video"
      ? (schemaAtPath.data.referencedModule as ModuleFilePath | undefined)
      : undefined;
  const setSchemaData = useModuleSchema(referencedModule);
  const setSchema = setSchemaData?.type === "record" ? setSchemaData : null;
  const setEntry = useVideosetEntry(
    referencedModule,
    sourceAtPath.status === "success" ? sourceAtPath.data?.path : undefined,
  );
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The picked file, played from memory until the server can serve it.
   *
   * An upload is only servable once its patch is saved, and a video is the
   * slowest thing in the Studio to upload — so without this the field shows
   * nothing for as long as the upload takes.
   */
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const portalContainer = useValPortal();
  useEffect(() => {
    return () => {
      if (localUrl) {
        URL.revokeObjectURL(localUrl);
      }
    };
  }, [localUrl]);

  if (schemaAtPath.status === "error") {
    return (
      <FieldSchemaError path={path} error={schemaAtPath.error} type={type} />
    );
  }
  if (sourceAtPath.status === "error") {
    return (
      <FieldSourceError
        path={path}
        error={sourceAtPath.error}
        schema={schemaAtPath}
      />
    );
  }
  if (
    sourceAtPath.status === "not-found" ||
    schemaAtPath.status === "not-found"
  ) {
    return <FieldNotFound path={path} type={type} />;
  }
  if (schemaAtPath.status === "loading" || config === undefined) {
    return <FieldLoading path={path} type={type} />;
  }
  if (schemaAtPath.data.type !== type) {
    return (
      <FieldSchemaMismatchError
        path={path}
        expectedType={type}
        actualType={schemaAtPath.data.type}
      />
    );
  }
  const schema: SerializedVideoSchema = schemaAtPath.data;
  const source = sourceAtPath.data;
  if (source === undefined) {
    return <FieldNotFound path={path} type={type} />;
  }
  const clientSideOnly =
    sourceAtPath.status === "success" && sourceAtPath.clientSideOnly;
  /**
   * What is known about the FILE: a set-backed field's value carries none of
   * it, so it is read off the set's entry, the way `fillFromGallery` does for
   * a page.
   */
  const fileInfo = {
    mimeType: setEntry?.mimeType ?? source?.mimeType,
    width: setEntry?.width ?? source?.width,
    height: setEntry?.height ?? source?.height,
    duration: setEntry?.duration ?? source?.duration,
  };
  const busy = phase.kind !== "idle";
  // Not before a bucket is picked either: see `ImageField`.
  const remoteUploadDisabled =
    !!schema.remote &&
    (remoteFiles.status !== "ready" || !currentRemoteFileBucket);
  // A set-backed field whose set is not in `val.modules` cannot add to it.
  const setMissing = !!referencedModule && setSchema === null;
  const disabled = !!readonly || remoteUploadDisabled || setMissing;
  // The field's own option wins, then its set's — as for an image and its
  // gallery. `s.video(set)` serializes no `dir` or `accept` of its own.
  const dir = schema.options?.dir ?? setSchema?.dir ?? "/public/val";
  const accept =
    schema.options?.accept ?? setSchema?.accept ?? DEFAULT_VIDEO_ACCEPT;
  const stream =
    schema.options?.stream !== undefined
      ? schema.options.stream
      : setSchema?.stream;
  const remote: RemoteUploadConfig | null =
    schema.remote && remoteFiles.status === "ready" && currentRemoteFileBucket
      ? {
          publicProjectId: remoteFiles.publicProjectId,
          coreVersion: remoteFiles.coreVersion,
          bucket: currentRemoteFileBucket,
          remoteHost: config.remoteHost,
        }
      : null;

  /** A file's URL, including while it is a draft. */
  const urlOf = (media: { path: string; patch_id?: string }) => {
    const patchId = filePatchIds.get(media.path) ?? media.patch_id;
    return Internal.mediaUrl({
      path: media.path,
      ...(patchId ? { patch_id: patchId } : {}),
    });
  };
  const serverUrl = source && !clientSideOnly ? urlOf(source) : null;
  const isHls = !!source && Internal.media.isHlsVideo(source);
  const playerUrl = localUrl ?? serverUrl;
  const playerIsHls = localUrl ? false : isHls;
  /**
   * What this field chose, and what the page plays: its own choices over the
   * set entry's, key by key — `fillFromGallery`'s merge, so the player here
   * and the page agree.
   */
  const own = videoChoicesOf(source);
  const shown = effectiveChoices(own, setEntry?.choices);
  const posterUrl = shown.poster ? urlOf(shown.poster) : null;
  const filename = source
    ? isHls
      ? localPathOf(source.path).split("/").slice(-2, -1)[0]
      : localPathOf(source.path).split("/").pop()
    : null;

  const write = (patch: Patch) => addPatch(patch, type);
  const uploadPatch = (patch: Patch, onDone?: () => void) => {
    setPhase({ kind: "uploading", progress: 0 });
    let failed = false;
    return addAndUploadPatchWithFileOps(
      patch,
      "file",
      (message) => {
        failed = true;
        setError(message);
      },
      (bytesUploaded, totalBytes, currentFile, totalFiles) => {
        setPhase({
          kind: "uploading",
          progress: Math.round(
            ((currentFile + bytesUploaded / Math.max(1, totalBytes)) /
              Math.max(1, totalFiles)) *
              100,
          ),
        });
      },
    ).finally(() => {
      setPhase({ kind: "idle" });
      if (!failed) {
        onDone?.();
      }
    });
  };

  const upload = async (file: File) => {
    setError(null);
    setNotice(null);
    const objectUrl = URL.createObjectURL(file);
    setLocalUrl(objectUrl);
    try {
      const prepared = await prepareVideoUpload(
        file,
        objectUrl,
        { accept, stream },
        setPhase,
      );
      if (prepared.status === "error") {
        setError(prepared.message);
        return;
      }
      setNotice(prepared.notice);
      const { metadata } = prepared;
      const posterTime = defaultPosterTime(metadata.duration);
      let poster: PosterUpload | null = null;
      try {
        poster = await toPosterUpload(
          await captureFrame(objectUrl, posterTime),
        );
      } catch {
        // No poster is not a failed upload: the page shows the first frame.
      }
      const input = {
        patchPath,
        dir,
        filename: file.name,
        upload: prepared.upload,
        metadata,
        poster,
        posterTime: poster ? posterTime : null,
        keep: {
          alt: source?.alt,
          hotspot: source?.hotspot,
          captions: source?.captions,
        },
        remote,
        schema,
      };
      if (referencedModule) {
        const { patch, entry } = createSetBackedVideoPatch(
          input,
          Internal.getSHA256Hash,
        );
        // The set gets its entry only once the bytes are up: an entry naming
        // a file that never arrived is worse than a moment without one.
        await uploadPatch(patch, () =>
          addModuleFilePatch(
            referencedModule,
            [
              {
                op: "add",
                path: [entry.key],
                value: { ...entry.value, alt: null },
              },
            ],
            "record",
          ),
        );
      } else {
        const { patch } = createVideoPatch(input, Internal.getSHA256Hash);
        await uploadPatch(patch);
      }
    } catch (err) {
      console.error("Val: video upload failed", err);
      setError(
        `Could not upload the video: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPhase({ kind: "idle" });
      // The local copy was only ever a stand-in while the bytes went up. From
      // here on the field plays what was STORED — which is what "Use current
      // frame" captures from, and what the page will get.
      setLocalUrl(null);
    }
  };

  const detail = source
    ? [
        fileInfo.width && fileInfo.height
          ? `${fileInfo.width}×${fileInfo.height}`
          : null,
        typeof fileInfo.duration === "number"
          ? formatTime(fileInfo.duration)
          : null,
        isHls ? "HLS stream" : (fileInfo.mimeType ?? null),
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const progressPercentage =
    phase.kind === "converting" || phase.kind === "uploading"
      ? phase.progress
      : null;

  /**
   * Rename a stream: every file of it moves to the new directory, so the
   * bytes are read back from where the player gets them, in the same patch
   * as the new `path`. See `renameVideo.ts`.
   */
  const renameStream = async (newBase: string): Promise<string | null> => {
    if (!source) return "There is no video to rename.";
    try {
      const files = await readStream(
        source.path,
        urlOf(source),
        fetchStreamFile,
        window.location.href,
      );
      const built = buildStreamRenamePatch({
        patchPath,
        masterPath: source.path,
        newBase,
        files,
        schema,
        sha256: Internal.getSHA256Hash,
      });
      if (built.status === "unchanged") return null;
      if (built.status === "error") return built.message;
      let failed: string | null = null;
      setPhase({ kind: "uploading", progress: 0 });
      await addAndUploadPatchWithFileOps(
        built.patch,
        "file",
        (message) => {
          failed = message;
        },
        () => {},
      );
      setPhase({ kind: "idle" });
      return failed;
    } catch (err) {
      setPhase({ kind: "idle" });
      return err instanceof Error ? err.message : String(err);
    }
  };

  const actions = (
    <>
      {/*
       * One control for "which video", as in the image field: a field picking
       * from a set opens the set, with the upload inside it; a field with its
       * own file has nothing to choose between, so the button is the dialog.
       */}
      {referencedModule ? (
        <ModuleMediaPicker
          compact
          isVideo
          modulePath={referencedModule}
          selectedRef={source?.path ?? null}
          disabled={disabled || busy}
          portalContainer={portalContainer}
          footer={
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs",
                "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              <Upload size={13} />
              Upload into {prettyModuleName(referencedModule)}
            </button>
          }
          onSelect={(entry: GalleryEntry) => {
            setLocalUrl(null);
            // Only the path: what is true of the file stays in the set. The
            // times, poster and captions were about the video it replaces.
            write([
              {
                op: "replace",
                path: patchPath,
                value: { path: entry.filePath },
              },
            ]);
          }}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || busy}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          {source ? "Replace" : "Choose video"}
        </Button>
      )}
      {source && filename && !readonly && !clientSideOnly && (
        <RenameFileButton
          path={path}
          filePath={source.path}
          filename={filename}
          metadata={
            fileInfo.mimeType === undefined
              ? undefined
              : {
                  mimeType: fileInfo.mimeType,
                  ...(fileInfo.width !== undefined
                    ? { width: fileInfo.width }
                    : {}),
                  ...(fileInfo.height !== undefined
                    ? { height: fileInfo.height }
                    : {}),
                }
          }
          fileType="file"
          // A set's video is renamed in the set, where every field using it
          // is rewritten with it; the button says so and goes there.
          referencedModule={referencedModule}
          disabled={busy}
          portalContainer={portalContainer}
          rename={isHls && !referencedModule ? renameStream : undefined}
        />
      )}
      {schema.opt && source && !readonly && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setLocalUrl(null);
            write([{ op: "replace", path: patchPath, value: null }]);
          }}
        >
          <X className="mr-1.5 h-3.5 w-3.5" />
          Remove
        </Button>
      )}
    </>
  );

  return (
    <div id={path} className="flex flex-col gap-5">
      {schema.remote && remoteFiles.status === "inactive" && (
        <div className="p-4 rounded bg-bg-error-primary text-fg-error-primary">
          {getRemoteFilesError(remoteFiles.reason)}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="p-4 rounded bg-bg-error-primary text-fg-error-primary"
        >
          {error}
        </div>
      )}
      {notice && (
        <p role="status" className="text-xs text-fg-secondary">
          {notice}
        </p>
      )}
      <input
        hidden
        ref={fileInputRef}
        type="file"
        id={`video_input:${path}`}
        accept={accept}
        disabled={disabled || busy}
        onChange={(ev) => {
          const file = ev.currentTarget.files?.[0];
          if (file) {
            upload(file);
          }
          ev.target.value = "";
        }}
      />
      {/*
       * The same card the image field uses, with the player where the picture
       * would be: a video reads as one more kind of media rather than as a
       * different form. The controls float over the TOP of it, clear of the
       * player's own along the bottom.
       */}
      <ImageCard
        url={playerUrl}
        name={filename ?? null}
        detail={detail}
        compact={compact}
        uploading={busy}
        progressPercentage={progressPercentage}
        onDropFile={readonly ? undefined : upload}
        dropDisabled={disabled || busy}
        actions={actions}
        emptyActions={actions}
        emptyLabel={{ drop: "Drop a video here, or", none: "No video yet" }}
        emptyIcon={
          <Film size={22} strokeWidth={1.5} className="text-fg-secondary-alt" />
        }
        media={
          playerUrl && (
            <VideoPlayer
              ref={videoRef}
              src={playerUrl}
              isHls={playerIsHls}
              poster={posterUrl ?? undefined}
              startTime={shown.startTime}
              endTime={shown.endTime}
              tracks={
                localUrl
                  ? undefined
                  : shown.captions?.map((track) => ({
                      ...track,
                      url: urlOf(track),
                    }))
              }
              className="h-full w-full bg-black object-contain"
              onError={setError}
            />
          )
        }
      />
      {phase.kind !== "idle" && (
        <p role="status" className="-mt-3 text-xs text-fg-secondary">
          {phase.kind === "reading"
            ? "Reading the video…"
            : phase.kind === "converting"
              ? `Converting to a stream… ${phase.progress}%`
              : `Uploading… ${phase.progress}%`}
        </p>
      )}
      {source && (
        <VideoChoices
          idBase={path}
          own={own}
          inherited={setEntry?.choices ?? null}
          patchPath={patchPath}
          videoPath={source.path}
          dir={dir}
          remote={remote}
          schema={schema}
          videoRef={videoRef}
          canCapture={!!serverUrl && !localUrl && !busy}
          urlOf={urlOf}
          disabled={disabled || busy}
          write={write}
          upload={(patch) => uploadPatch(patch)}
          onError={setError}
        />
      )}
    </div>
  );
}

export function VideoPreview({ path }: { path: SourcePath }) {
  const sourceAtPath = useShallowSourceAtPath(path, type);
  if (sourceAtPath.status === "error") {
    return <FieldSourceError path={path} error={sourceAtPath.error} />;
  }
  if (!("data" in sourceAtPath) || sourceAtPath.data === undefined) {
    return <PreviewLoading path={path} />;
  }
  if (sourceAtPath.data === null) {
    return <PreviewNull path={path} />;
  }
  return <Film size={12} />;
}

type VideosetEntryInfo = {
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  /** The entry's defaults, which the field shows until it sets its own. */
  choices: VideoChoicesValue;
};

const NO_PATH = "" as SourcePath;

/**
 * The set entry a set-backed field points at, read on its own: one entry by
 * path, so the field does not subscribe to the whole set. Unlike an image
 * gallery's, a set's entries are keyed by exactly the path the field holds
 * (a remote one by its ref), so there is one key to read, not two.
 */
function useVideosetEntry(
  setModule: ModuleFilePath | undefined,
  videoPath: string | undefined,
): VideosetEntryInfo | undefined {
  const entryPath =
    setModule && videoPath
      ? (Internal.createValPathOfItem(setModule, videoPath) ?? NO_PATH)
      : NO_PATH;
  const entry = useSourceAtPath(entryPath);
  if (entryPath === NO_PATH || entry.status !== "success") {
    return undefined;
  }
  const data = entry.data;
  if (typeof data !== "object" || data === null || isJsonArray(data)) {
    return undefined;
  }
  const { mimeType, width, height, duration } = data;
  return {
    mimeType: typeof mimeType === "string" ? mimeType : undefined,
    width: typeof width === "number" ? width : undefined,
    height: typeof height === "number" ? height : undefined,
    duration: typeof duration === "number" ? duration : undefined,
    choices: videoChoicesOf(data),
  };
}
