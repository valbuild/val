/**
 * What the Studio reads out of a video with nothing but a `<video>` element:
 * its size and length, and a still of one frame.
 *
 * A `<video>` rather than mediabunny, because whatever this browser can PLAY
 * is what the editor is choosing a poster from, and a frame grabbed from the
 * element is exactly the frame on screen.
 */

export type VideoInfo = { width: number; height: number; duration: number };

function waitFor(
  video: HTMLVideoElement,
  event: "loadedmetadata" | "seeked" | "loadeddata",
  timeoutMs = 20_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for the video (${event})`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(
        new Error(
          video.error?.message ||
            "This browser cannot play this video, so it cannot be read.",
        ),
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
  });
}

function createVideo(src: string): HTMLVideoElement {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  // A remote file is on another origin. Without CORS a frame drawn from it
  // taints the canvas and cannot be read back.
  video.crossOrigin = "anonymous";
  video.src = src;
  return video;
}

export async function readVideoInfo(src: string): Promise<VideoInfo> {
  const video = createVideo(src);
  try {
    await waitFor(video, "loadedmetadata");
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/** Where a poster is taken from when nobody has chosen: a second in, or the
 * middle of a clip shorter than two. The first frame is so often black. */
export function defaultPosterTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return Math.round(Math.min(1, duration / 2) * 100) / 100;
}

export type CapturedFrame = {
  /** A base64 data URL, as every other upload in the Studio is. */
  dataUrl: string;
  bytes: Uint8Array<ArrayBuffer>;
  mimeType: string;
  width: number;
  height: number;
};

/** Longest side of a poster. A still at 4K is megabytes nobody needs. */
const MAX_POSTER_SIDE = 1920;

/**
 * The frame at `time`, as an image.
 *
 * WebP where `canvas.toBlob` can make one, otherwise JPEG — `toBlob` falls
 * back to PNG silently, so the type that came out is checked rather than
 * assumed (the same trap as in `encodeImage`).
 */
export async function captureFrameFromElement(
  video: HTMLVideoElement,
): Promise<CapturedFrame> {
  const scale = Math.min(
    1,
    MAX_POSTER_SIDE / Math.max(video.videoWidth, video.videoHeight),
  );
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not draw the frame: no 2d canvas.");
  }
  ctx.drawImage(video, 0, 0, width, height);
  const blob = await toBlob(canvas, "image/webp", 0.85).then(async (webp) =>
    webp?.type === "image/webp"
      ? webp
      : await toBlob(canvas, "image/jpeg", 0.85),
  );
  if (!blob) {
    throw new Error("Could not encode the frame.");
  }
  return {
    dataUrl: await blobToDataUrl(blob),
    bytes: new Uint8Array(await blob.arrayBuffer()),
    mimeType: blob.type,
    width,
    height,
  };
}

export async function captureFrame(
  src: string,
  time: number,
  options: { isHls?: boolean } = {},
): Promise<CapturedFrame> {
  const video = createVideo(src);
  // A stream where the browser cannot play one itself is played through
  // hls.js, as the player does — loaded only when it is needed.
  let destroy = () => {};
  if (
    options.isHls &&
    video.canPlayType("application/vnd.apple.mpegurl") === ""
  ) {
    video.removeAttribute("src");
    const { default: Hls } = await import("hls.js");
    if (!Hls.isSupported()) {
      throw new Error("This browser cannot play the stream.");
    }
    const hls = new Hls();
    hls.loadSource(src);
    hls.attachMedia(video);
    destroy = () => hls.destroy();
  }
  try {
    await waitFor(video, "loadeddata");
    video.currentTime = time;
    await waitFor(video, "seeked");
    return await captureFrameFromElement(video);
  } finally {
    destroy();
    video.removeAttribute("src");
    video.load();
  }
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Could not read the file"));
      }
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Could not read the file")),
    );
    reader.readAsDataURL(blob);
  });
}
