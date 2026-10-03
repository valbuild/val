import {
  DEFAULT_VIDEO_ACCEPT,
  DEFAULT_VIDEO_RENDITIONS,
  DEFAULT_VIDEO_SEGMENT_DURATION,
  Internal,
  SourcePath,
  type SerializedVideoSchema,
  type VideoCaptionSource,
} from "@valbuild/core";
import type { Patch } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";
import { Captions, Film, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FieldLoading } from "../FieldLoading";
import { FieldNotFound } from "../FieldNotFound";
import { FieldSchemaError } from "../FieldSchemaError";
import { FieldSchemaMismatchError } from "../FieldSchemaMismatchError";
import { FieldSourceError } from "../FieldSourceError";
import { PreviewLoading, PreviewNull } from "../Preview";
import {
  useFilePatchIds,
  useShallowSourceAtPath,
  useValConfig,
  useValField,
} from "../ValFieldProvider";
import {
  useCurrentRemoteFileBucket,
  useRemoteFiles,
} from "../ValRemoteProvider";
import { Button } from "../designSystem/button";
import { Checkbox } from "../designSystem/checkbox";
import { Input } from "../designSystem/input";
import { FocalPointPicker } from "./FocalPointPicker";
import { getRemoteFilesError } from "./ImageField";
import { Section } from "./MediaSummaryRow";
import { ImageCard } from "./ImageCard";
import { MediaThumbnail } from "../MediaThumbnail";
import { VideoPlayer } from "./VideoPlayer";
import {
  bytesToBase64,
  createCaptionPatch,
  createPosterPatch,
  createVideoPatch,
  localPathOf,
  roundTime,
  type PosterUpload,
  type RemoteUploadConfig,
  type UploadFile,
  type VideoUpload,
} from "../../utils/video/createVideoPatch";
import {
  blobToDataUrl,
  captureFrame,
  captureFrameFromElement,
  defaultPosterTime,
  readVideoInfo,
  type CapturedFrame,
  type VideoInfo,
} from "../../utils/video/readVideo";
import { canTranscodeVideo } from "../../utils/video/transcodeSupport";
import { sha256Hex } from "../../utils/video/sha256";
import { isVtt, srtToVtt } from "../../utils/video/srtToVtt";
import {
  buildStreamRenamePatch,
  readStream,
} from "../../utils/video/renameVideo";
import { RenameFileButton } from "./RenameFileButton";
import { useValPortal } from "../ValPortalProvider";

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
  } = useValField(path, type);
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
  const captionInputRef = useRef<HTMLInputElement>(null);
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
  const busy = phase.kind !== "idle";
  const remoteUploadDisabled =
    !!schema.remote && remoteFiles.status !== "ready";
  const disabled = !!readonly || remoteUploadDisabled;
  const dir = schema.options?.dir ?? "/public/val";
  const accept = schema.options?.accept ?? DEFAULT_VIDEO_ACCEPT;
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
  const posterUrl = source?.poster ? urlOf(source.poster) : null;
  const filename = source
    ? isHls
      ? localPathOf(source.path).split("/").slice(-2, -1)[0]
      : localPathOf(source.path).split("/").pop()
    : null;

  const write = (patch: Patch) => addPatch(patch, type);
  const setField = (
    key: "alt" | "posterTime" | "startTime" | "endTime" | "hotspot",
    value: string | number | { x: number; y: number } | undefined,
  ) => {
    if (!source) return;
    const fieldPath = patchPath.concat(key);
    if (value === undefined) {
      if (source[key] !== undefined && array.isNonEmpty(fieldPath)) {
        write([{ op: "remove", path: fieldPath }]);
      }
      return;
    }
    // "add", never "replace": on an object key it is create-or-set, so it
    // survives the key having gone away meanwhile. See `ImageField`'s alt.
    write([{ op: "add", path: fieldPath, value }]);
  };

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
    const mimeType = file.type || Internal.filenameToMimeType(file.name) || "";
    if (mimeType && !mimeType.startsWith("video/")) {
      setError(`${file.name} is not a video.`);
      return;
    }
    if (mimeType && !Internal.mimeTypeMatchesAccept(mimeType, accept)) {
      setError(
        `${file.name} is a ${mimeType}, and this field takes ${accept}.`,
      );
      return;
    }
    setPhase({ kind: "reading" });
    const objectUrl = URL.createObjectURL(file);
    setLocalUrl(objectUrl);
    try {
      let info: VideoInfo | null = null;
      try {
        info = await readVideoInfo(objectUrl);
      } catch {
        // Not playable here. A stream may still be made of it — the
        // converter decodes with WebCodecs, not with this element.
      }
      let upload: VideoUpload | null = null;
      let metadata = info;
      const stream = schema.options?.stream;
      if (stream && canTranscodeVideo()) {
        const sourceBytes = new Uint8Array(await file.arrayBuffer());
        const sourceSha256 = await sha256Hex(sourceBytes);
        setPhase({ kind: "converting", progress: 0 });
        // Imported here rather than at the top: it is the worker's entry point,
        // and nothing else in the Studio needs it.
        const { transcodeToHls } =
          await import("../../utils/video/transcodeVideo");
        const result = await transcodeToHls(
          file,
          {
            renditions: stream.renditions ?? DEFAULT_VIDEO_RENDITIONS,
            segmentDuration:
              stream.segmentDuration ?? DEFAULT_VIDEO_SEGMENT_DURATION,
          },
          (progress) =>
            setPhase({
              kind: "converting",
              progress: Math.round(progress * 100),
            }),
        );
        if (result.status === "error") {
          setError(`Could not convert the video: ${result.message}`);
          return;
        }
        if (result.status === "done") {
          const files: Record<string, UploadFile> = {};
          for (const output of result.files) {
            const bytes = new Uint8Array(output.bytes);
            files[output.name] = {
              bytes,
              mimeType: output.mimeType,
              sha256: await sha256Hex(bytes),
              dataUrl: await blobToDataUrl(
                new Blob([bytes], { type: output.mimeType }),
              ),
            };
          }
          upload = {
            kind: "hls",
            files,
            sourceSha256,
            sourceMimeType: mimeType || "video/mp4",
          };
          metadata = {
            width: result.width,
            height: result.height,
            duration: result.duration,
          };
        } else {
          setNotice(
            `This browser cannot convert video to a stream (${result.message}), so the file was uploaded as it is.`,
          );
        }
      } else if (stream) {
        setNotice(
          "This browser cannot convert video to a stream (it needs WebCodecs, on https or localhost), so the file was uploaded as it is.",
        );
      }
      if (!metadata) {
        setError(
          "This browser cannot read this video. An .mp4 with H.264 video plays everywhere.",
        );
        return;
      }
      if (upload === null) {
        if (!mimeType) {
          setError(`Could not tell what kind of video ${file.name} is.`);
          return;
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        upload = {
          kind: "file",
          file: {
            bytes,
            mimeType,
            sha256: await sha256Hex(bytes),
            dataUrl: await blobToDataUrl(file),
          },
        };
      }
      const posterTime = defaultPosterTime(metadata.duration);
      let poster: PosterUpload | null = null;
      try {
        poster = await toPosterUpload(
          await captureFrame(objectUrl, posterTime),
        );
      } catch {
        // No poster is not a failed upload: the page shows the first frame.
      }
      const { patch } = createVideoPatch(
        {
          patchPath,
          dir,
          filename: file.name,
          upload,
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
        },
        Internal.getSHA256Hash,
      );
      await uploadPatch(patch);
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

  const takePosterFromPlayer = async () => {
    const video = videoRef.current;
    if (!source || !video) return;
    setError(null);
    try {
      const frame = await captureFrameFromElement(video);
      const poster = await toPosterUpload(frame);
      await uploadPatch(
        createPosterPatch({
          patchPath,
          dir,
          videoPath: source.path,
          poster,
          posterTime: video.currentTime,
          remote,
          schema,
        }),
      );
    } catch (err) {
      setError(
        `Could not take a poster from this frame: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const addCaptions = async (file: File) => {
    if (!source) return;
    setError(null);
    try {
      const text = await file.text();
      const vtt = isVtt(text) ? text : srtToVtt(text);
      const bytes = new TextEncoder().encode(vtt);
      const dataUrl = `data:text/vtt;base64,${bytesToBase64(bytes)}`;
      const srclang = guessLanguage(file.name) ?? "";
      const name = file.name.replace(/\.(srt|vtt)$/i, "") + ".vtt";
      await uploadPatch(
        createCaptionPatch({
          patchPath,
          dir,
          filename: name,
          file: {
            bytes,
            dataUrl,
            mimeType: "text/vtt",
            sha256: await sha256Hex(bytes),
          },
          track: {
            srclang,
            label: file.name.replace(/\.(srt|vtt)$/i, ""),
          },
          existing: source.captions,
          remote,
          schema,
        }),
      );
    } catch (err) {
      setError(
        `Could not add the captions: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const setCaption = (
    index: number,
    key: "srclang" | "label" | "kind" | "default",
    value: string | boolean | undefined,
  ) => {
    const fieldPath = patchPath.concat("captions", String(index), key);
    if (value === undefined) {
      if (array.isNonEmpty(fieldPath)) {
        write([{ op: "remove", path: fieldPath }]);
      }
      return;
    }
    const ops: Patch = [{ op: "add", path: fieldPath, value }];
    // One default at a time: turning one on turns the others off in the same
    // patch, so there is never a moment where two are.
    if (key === "default" && value === true) {
      source?.captions?.forEach((track, i) => {
        if (i !== index && track.default) {
          ops.push({
            op: "add",
            path: patchPath.concat("captions", String(i), "default"),
            value: false,
          });
        }
      });
    }
    write(ops);
  };

  const removeCaption = (index: number) => {
    const fieldPath = patchPath.concat("captions", String(index));
    if (array.isNonEmpty(fieldPath)) {
      write([{ op: "remove", path: fieldPath }]);
    }
  };

  const detail = source
    ? [
        source.width && source.height
          ? `${source.width}×${source.height}`
          : null,
        typeof source.duration === "number"
          ? formatTime(source.duration)
          : null,
        isHls ? "HLS stream" : (source.mimeType ?? null),
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
        async (url) => {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Could not read ${url}: HTTP ${res.status}`);
          }
          return {
            bytes: new Uint8Array(await res.arrayBuffer()),
            mimeType:
              res.headers.get("content-type")?.split(";")[0] ||
              Internal.filenameToMimeType(new URL(url).pathname) ||
              "application/octet-stream",
          };
        },
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
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        {source ? "Replace" : "Choose video"}
      </Button>
      {source && filename && !readonly && !clientSideOnly && (
        <RenameFileButton
          path={path}
          filePath={source.path}
          filename={filename}
          metadata={{
            mimeType: source.mimeType,
            ...(source.width !== undefined ? { width: source.width } : {}),
            ...(source.height !== undefined ? { height: source.height } : {}),
          }}
          fileType="file"
          referencedModule={undefined}
          disabled={busy}
          portalContainer={portalContainer}
          rename={isHls ? renameStream : undefined}
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
              startTime={source?.startTime}
              endTime={source?.endTime}
              tracks={
                localUrl
                  ? undefined
                  : source?.captions?.map((track) => ({
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
        <>
          <Section
            label="Description"
            hint="What happens in the video, for people who cannot see it."
          >
            <Input
              id={Internal.createValPathOfItem(path, "alt")}
              value={source.alt ?? ""}
              disabled={disabled || busy}
              onChange={(ev) => setField("alt", ev.target.value)}
            />
          </Section>
          {/*
           * The poster is shown here, beside the control that sets it — not
           * as the card's thumbnail, where it read as the video itself.
           */}
          <Section
            label="Poster"
            hint="The still shown before the video plays. Pause the video on the frame you want, then use it."
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative h-[5.625rem] w-40 shrink-0 overflow-hidden rounded-md border border-border-primary bg-bg-secondary">
                {posterUrl ? (
                  <MediaThumbnail
                    url={posterUrl}
                    alt={source.alt}
                    hotspot={source.hotspot}
                  />
                ) : (
                  <span className="grid h-full place-items-center text-[0.6875rem] text-fg-secondary-alt">
                    No poster
                  </span>
                )}
              </div>
              <div className="flex flex-col items-start gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || busy || !serverUrl || !!localUrl}
                  onClick={takePosterFromPlayer}
                >
                  Use current frame
                </Button>
                <span className="text-xs text-fg-secondary">
                  {typeof source.posterTime === "number"
                    ? `Taken at ${formatTime(source.posterTime)}`
                    : "Not set"}
                </span>
              </div>
            </div>
          </Section>
          <Section
            label="Start and end"
            hint="Play only part of the video. The file is not cut; the page starts and stops playback here."
            collapsible
            summary={
              source.startTime !== undefined || source.endTime !== undefined
                ? `${formatTime(source.startTime ?? 0)} – ${
                    source.endTime !== undefined
                      ? formatTime(source.endTime)
                      : "end"
                  }`
                : "Whole video"
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <TimeInput
                label="Start"
                value={source.startTime}
                disabled={disabled || busy}
                onChange={(value) => setField("startTime", value)}
                onUseCurrent={() =>
                  videoRef.current &&
                  setField("startTime", roundTime(videoRef.current.currentTime))
                }
              />
              <TimeInput
                label="End"
                value={source.endTime}
                disabled={disabled || busy}
                onChange={(value) => setField("endTime", value)}
                onUseCurrent={() =>
                  videoRef.current &&
                  setField("endTime", roundTime(videoRef.current.currentTime))
                }
              />
            </div>
          </Section>
          <Section
            label="Focal point"
            hint={
              posterUrl
                ? "Click or drag on the poster to say what must stay in frame when the page crops the video."
                : "Set a poster first: the focal point is chosen on it."
            }
            collapsible
            summary={
              source.hotspot
                ? `${Math.round(source.hotspot.x * 100)}%, ${Math.round(source.hotspot.y * 100)}%`
                : "Not set"
            }
          >
            {posterUrl && (
              <FocalPointPicker
                url={posterUrl}
                hotspot={source.hotspot}
                alt={source.alt}
                readonly={disabled || busy}
                id={Internal.createValPathOfItem(path, "hotspot")}
                onChange={(hotspot) => setField("hotspot", hotspot)}
              />
            )}
            {source.hotspot && (
              <Button
                className="mt-2"
                variant="ghost"
                size="sm"
                disabled={disabled || busy}
                onClick={() => setField("hotspot", undefined)}
              >
                Clear focal point
              </Button>
            )}
          </Section>
          <Section
            label="Captions"
            hint="WebVTT (.vtt) or SubRip (.srt) files, one per language. .srt is converted to .vtt."
          >
            <div className="flex flex-col gap-3">
              {source.captions?.map((track, index) => (
                <CaptionRow
                  key={`${index}:${track.path}`}
                  track={track}
                  path={path}
                  index={index}
                  disabled={disabled || busy}
                  onChange={(key, value) => setCaption(index, key, value)}
                  onRemove={() => removeCaption(index)}
                />
              ))}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || busy}
                  onClick={() => captionInputRef.current?.click()}
                >
                  <Captions className="mr-1.5 h-3.5 w-3.5" />
                  Add captions
                </Button>
              </div>
              <input
                hidden
                ref={captionInputRef}
                type="file"
                accept=".vtt,.srt,text/vtt"
                disabled={disabled || busy}
                onChange={(ev) => {
                  const file = ev.currentTarget.files?.[0];
                  if (file) {
                    addCaptions(file);
                  }
                  ev.target.value = "";
                }}
              />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function CaptionRow({
  track,
  path,
  index,
  disabled,
  onChange,
  onRemove,
}: {
  track: VideoCaptionSource;
  path: SourcePath;
  index: number;
  disabled: boolean;
  onChange: (
    key: "srclang" | "label" | "kind" | "default",
    value: string | boolean | undefined,
  ) => void;
  onRemove: () => void;
}) {
  const id = `${path}:captions:${index}`;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-primary p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-fg-secondary">
          {localPathOf(track.path).split("/").pop()}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onRemove}
          aria-label="Remove caption track"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-[6rem_1fr] gap-2">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Language
          <Input
            value={track.srclang}
            placeholder="en"
            disabled={disabled}
            onChange={(ev) => onChange("srclang", ev.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Label
          <Input
            value={track.label ?? ""}
            placeholder="English"
            disabled={disabled}
            onChange={(ev) =>
              onChange(
                "label",
                ev.target.value === "" ? undefined : ev.target.value,
              )
            }
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <span className="flex items-center gap-2">
          <Checkbox
            id={`${id}:kind`}
            checked={track.kind === "captions"}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange("kind", checked ? "captions" : undefined)
            }
          />
          <label htmlFor={`${id}:kind`} className="text-xs text-fg-secondary">
            Describes sounds too
          </label>
        </span>
        <span className="flex items-center gap-2">
          <Checkbox
            id={`${id}:default`}
            checked={!!track.default}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange("default", checked ? true : undefined)
            }
          />
          <label
            htmlFor={`${id}:default`}
            className="text-xs text-fg-secondary"
          >
            On by default
          </label>
        </span>
      </div>
    </div>
  );
}

/**
 * Seconds, typed as `1:05.5` or `65.5`, written when the input loses focus —
 * a half-typed time is not a time, and writing one would trip validation on
 * every keystroke.
 */
function TimeInput({
  label,
  value,
  disabled,
  onChange,
  onUseCurrent,
}: {
  label: string;
  value: number | undefined;
  disabled: boolean;
  onChange: (value: number | undefined) => void;
  onUseCurrent: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value !== undefined ? formatTime(value) : "");
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        {label}
        <Input
          value={shown}
          placeholder={label === "Start" ? "0:00" : "end"}
          disabled={disabled}
          onChange={(ev) => setDraft(ev.target.value)}
          onBlur={() => {
            if (draft === null) return;
            const parsed = parseTime(draft);
            setDraft(null);
            if (parsed === null) return;
            onChange(parsed === undefined ? undefined : roundTime(parsed));
          }}
        />
      </label>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={disabled}
        onClick={onUseCurrent}
      >
        Use current time
      </Button>
    </div>
  );
}

/** `m:ss.cc` — the hundredths only when there are any. */
export function formatTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const rest = total - minutes * 60;
  const whole = Math.floor(rest);
  const hundredths = Math.round((rest - whole) * 100);
  const base = `${minutes}:${String(whole).padStart(2, "0")}`;
  return hundredths > 0
    ? `${base}.${String(hundredths).padStart(2, "0")}`
    : base;
}

/**
 * `undefined` for an emptied input (clear the time), `null` for something
 * that is not a time (leave it as it was).
 */
export function parseTime(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parts = trimmed.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(\.\d+)?$/.test(part))) {
    return null;
  }
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** `intro.en.vtt` / `intro_nb-NO.srt` name their language often enough. */
function guessLanguage(filename: string): string | null {
  const match = /[._-]([a-z]{2}(?:-[A-Z]{2})?)\.(vtt|srt)$/.exec(filename);
  return match ? match[1] : null;
}

async function toPosterUpload(frame: CapturedFrame): Promise<PosterUpload> {
  return {
    bytes: frame.bytes,
    dataUrl: frame.dataUrl,
    mimeType: frame.mimeType,
    sha256: await sha256Hex(frame.bytes),
    width: frame.width,
    height: frame.height,
  };
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
