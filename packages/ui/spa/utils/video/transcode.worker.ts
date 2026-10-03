/// <reference lib="webworker" />
/**
 * Turns an upload into an HLS stream, off the main thread.
 *
 * mediabunny does the work: it demuxes the upload, decodes and re-encodes it
 * with WebCodecs into one H.264 rendition per requested height (the "fan-out"
 * of `Conversion`), encodes the audio once as AAC, and packages all of it as
 * CMAF behind an HLS master playlist. `singleFilePerPlaylist` keeps it to one
 * media file per rendition, addressed with byte ranges, so a two-minute video
 * is a handful of files to upload rather than hundreds of segments.
 *
 * H.264 and AAC because they are the pair every HLS player plays — Safari
 * natively, everything else through hls.js. A browser whose WebCodecs cannot
 * encode H.264 is answered `unsupported`, and the caller uploads the original
 * file instead of a stream nobody could play. AAC is the softer case: several
 * browsers decode it but cannot encode it, so mediabunny's own AAC encoder (a
 * WASM build of FFmpeg's) is loaded for those, and only for those.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CmafOutputFormat,
  Conversion,
  HlsOutputFormat,
  Input,
  Output,
  PathedTarget,
  QUALITY_HIGH,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import type {
  TranscodeReply,
  TranscodeRequest,
  TranscodedFile,
} from "./transcodeProtocol";
import { renditionHeights } from "./transcodeSupport";

const scope = self as unknown as DedicatedWorkerGlobalScope;

function reply(message: TranscodeReply, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

/** H.264 wants even dimensions. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

async function transcode(request: TranscodeRequest): Promise<void> {
  const input = new Input({
    source: new BlobSource(request.file),
    formats: ALL_FORMATS,
  });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    reply({
      type: "error",
      message: "The file has no video track.",
      unsupported: false,
    });
    return;
  }
  const sourceWidth = videoTrack.displayWidth;
  const sourceHeight = videoTrack.displayHeight;
  const duration = await input.computeDuration();
  const sizes = renditionHeights(request.renditions, sourceHeight).map(
    (height) => ({
      width: even((sourceWidth * height) / sourceHeight),
      height: even(height),
    }),
  );
  for (const size of sizes) {
    if (!(await canEncodeVideo("avc", size))) {
      reply({
        type: "error",
        message: `This browser cannot encode H.264 at ${size.width}×${size.height}.`,
        unsupported: true,
      });
      return;
    }
  }
  const audioTrack = await input.getPrimaryAudioTrack();
  if (audioTrack && !(await canEncodeAudio("aac"))) {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }

  const targets = new Map<string, { target: BufferTarget; mimeType: string }>();
  const output = new Output({
    format: new HlsOutputFormat({
      segmentFormat: new CmafOutputFormat(),
      targetDuration: request.segmentDuration,
      singleFilePerPlaylist: true,
      // `.mp4` rather than mediabunny's `.m4s`: the bytes are the same CMAF,
      // but every static host and `filenameToMimeType` know `.mp4`, and an
      // `.m4s` is served as `application/octet-stream` almost everywhere.
      getSegmentPath: (info) => `segments-${info.playlist.n}.mp4`,
    }),
    target: new PathedTarget("master.m3u8", (request) => {
      const target = new BufferTarget();
      targets.set(request.path, { target, mimeType: request.mimeType });
      return target;
    }),
  });
  const conversion = await Conversion.init({
    input,
    output,
    tracks: "primary",
    video: sizes.map((size) => ({
      ...size,
      fit: "contain" as const,
      codec: "avc" as const,
      quality: QUALITY_HIGH,
      // Every rendition switches at the same instants, or a player changing
      // quality mid-stream lands between key frames.
      keyFrameInterval: request.segmentDuration,
      forceTranscode: true,
    })),
    audio: { codec: "aac", quality: QUALITY_HIGH },
    showWarnings: false,
  });
  if (!conversion.isValid) {
    reply({
      type: "error",
      message:
        "This video cannot be converted: " +
        conversion.discardedTracks.map((t) => t.reason).join(", "),
      unsupported: false,
    });
    return;
  }
  conversion.onProgress = (progress) => {
    reply({ type: "progress", progress });
  };
  await conversion.execute();

  const files: TranscodedFile[] = [];
  for (const [path, { target, mimeType }] of targets) {
    if (target.buffer === null) {
      continue;
    }
    files.push({
      name: path,
      mimeType: path.endsWith(".m3u8")
        ? "application/vnd.apple.mpegurl"
        : mimeType.split(";")[0],
      bytes: target.buffer,
    });
  }
  files.sort((a, b) =>
    a.name === "master.m3u8" ? -1 : b.name === "master.m3u8" ? 1 : 0,
  );
  reply(
    {
      type: "done",
      files,
      width: sourceWidth,
      height: sourceHeight,
      duration,
    },
    files.map((file) => file.bytes),
  );
}

scope.onmessage = (event: MessageEvent<TranscodeRequest>) => {
  transcode(event.data).catch((err: unknown) => {
    reply({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      unsupported: false,
    });
  });
};
