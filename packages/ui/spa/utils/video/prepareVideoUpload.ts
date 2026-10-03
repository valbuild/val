import {
  DEFAULT_VIDEO_RENDITIONS,
  DEFAULT_VIDEO_SEGMENT_DURATION,
  Internal,
  type VideoStreamOption,
} from "@valbuild/core";
import type { UploadFile, VideoUpload } from "./createVideoPatch";
import { blobToDataUrl, readVideoInfo, type VideoInfo } from "./readVideo";
import { canTranscodeVideo } from "./transcodeSupport";
import { sha256Hex } from "./sha256";

export type PreparePhase =
  { kind: "reading" } | { kind: "converting"; progress: number };

export type PreparedVideo =
  | {
      status: "ok";
      upload: VideoUpload;
      metadata: VideoInfo;
      /**
       * Set when a stream was asked for and could not be made here, so the
       * file goes up as it is. Not an error: the video is still uploaded.
       */
      notice: string | null;
    }
  | { status: "error"; message: string };

/**
 * A picked file, made ready to upload: checked against `accept`, read for its
 * size and length, and — when `stream` asks for it and this browser can —
 * converted to an HLS stream.
 *
 * The one implementation of that step, for a video FIELD and for a SET: they
 * differ in what the patch names (a field's value, or a set's entry), never in
 * what is uploaded.
 *
 * `objectUrl` is the caller's, so it can keep playing the file from memory
 * while the bytes go up, and revoke it when they have.
 */
export async function prepareVideoUpload(
  file: File,
  objectUrl: string,
  options: { accept: string; stream: VideoStreamOption | undefined },
  onPhase: (phase: PreparePhase) => void,
): Promise<PreparedVideo> {
  const mimeType = file.type || Internal.filenameToMimeType(file.name) || "";
  if (mimeType && !mimeType.startsWith("video/")) {
    return { status: "error", message: `${file.name} is not a video.` };
  }
  if (mimeType && !Internal.mimeTypeMatchesAccept(mimeType, options.accept)) {
    return {
      status: "error",
      message: `${file.name} is a ${mimeType}, and this takes ${options.accept}.`,
    };
  }
  onPhase({ kind: "reading" });
  let info: VideoInfo | null = null;
  try {
    info = await readVideoInfo(objectUrl);
  } catch {
    // Not playable here. A stream may still be made of it — the converter
    // decodes with WebCodecs, not with this element.
  }
  let notice: string | null = null;
  const stream = options.stream;
  if (stream && canTranscodeVideo()) {
    const sourceBytes = new Uint8Array(await file.arrayBuffer());
    const sourceSha256 = await sha256Hex(sourceBytes);
    onPhase({ kind: "converting", progress: 0 });
    // Imported here rather than at the top: it is the worker's entry point,
    // and nothing else in the Studio needs it.
    const { transcodeToHls } = await import("./transcodeVideo");
    const result = await transcodeToHls(
      file,
      {
        renditions: stream.renditions ?? DEFAULT_VIDEO_RENDITIONS,
        segmentDuration:
          stream.segmentDuration ?? DEFAULT_VIDEO_SEGMENT_DURATION,
      },
      (progress) =>
        onPhase({ kind: "converting", progress: Math.round(progress * 100) }),
    );
    if (result.status === "error") {
      return {
        status: "error",
        message: `Could not convert the video: ${result.message}`,
      };
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
      return {
        status: "ok",
        upload: {
          kind: "hls",
          files,
          sourceSha256,
          sourceMimeType: mimeType || "video/mp4",
        },
        metadata: {
          width: result.width,
          height: result.height,
          duration: result.duration,
        },
        notice: null,
      };
    }
    notice = `This browser cannot convert video to a stream (${result.message}), so the file was uploaded as it is.`;
  } else if (stream) {
    notice =
      "This browser cannot convert video to a stream (it needs WebCodecs, on https or localhost), so the file was uploaded as it is.";
  }
  if (!info) {
    return {
      status: "error",
      message:
        "This browser cannot read this video. An .mp4 with H.264 video plays everywhere.",
    };
  }
  if (!mimeType) {
    return {
      status: "error",
      message: `Could not tell what kind of video ${file.name} is.`,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    status: "ok",
    upload: {
      kind: "file",
      file: {
        bytes,
        mimeType,
        sha256: await sha256Hex(bytes),
        dataUrl: await blobToDataUrl(file),
      },
    },
    metadata: info,
    notice,
  };
}
