/**
 * What the demo will take as an upload.
 *
 * Everything uploaded in a demo is held in the tab's memory, by the server
 * running there, for as long as the tab is open -- so a cap is what keeps one
 * large video from taking the tab down with it. It is checked on the bytes as
 * they would be SENT: after an image is re-encoded and scaled down (`encode`),
 * after a video is converted to a stream. A 12 MB photo straight off a phone is
 * well under the cap once it is a 2560px WebP, and refusing it for the size it
 * had before would refuse the photo the demo most wants to show working.
 */

export const DEMO_UPLOAD_LIMITS = {
  image: 10 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  other: 25 * 1024 * 1024,
};

/**
 * What a person who tries to upload is told when this browser cannot run the
 * demo's service worker (see `ValDemoRuntime.uploads`). Picking an image the
 * gallery already has still works, so that is what it offers.
 */
export const DEMO_UPLOADS_OFF =
  "Uploading in the demo needs a browser feature that is not available on this page. Pick an image that is already in the gallery instead.";

/** The mime type and decoded size of a base64 data URL, or null if it is not one. */
export function dataUrlSize(
  data: string,
): { mimeType: string; bytes: number } | null {
  const match = /^data:([^;,]*)(?:;[^,]*)?;base64,/.exec(data);
  if (!match) return null;
  const base64 = data.length - match[0].length;
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return {
    mimeType: match[1] ?? "",
    bytes: Math.floor((base64 * 3) / 4) - padding,
  };
}

function kindOf(mimeType: string): keyof typeof DEMO_UPLOAD_LIMITS {
  if (mimeType.startsWith("image/")) return "image";
  // An HLS stream is a playlist and one file of segments per rendition; the
  // segments are what is large, and they are `video/mp4`.
  if (mimeType.startsWith("video/") || mimeType.includes("mpegurl")) {
    return "video";
  }
  return "other";
}

const NOUN = { image: "image", video: "video", other: "file" };

function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/**
 * Why the demo will not take this upload, or null when it will.
 *
 * A delete (`data: null`) is always let through: it is how a failed upload's
 * other files are rolled back.
 */
export function checkDemoUpload(
  uploads: boolean,
  file: { data: string | null },
): string | null {
  if (file.data === null) return null;
  if (!uploads) return DEMO_UPLOADS_OFF;
  const size = dataUrlSize(file.data);
  if (size === null) return null;
  const kind = kindOf(size.mimeType);
  const limit = DEMO_UPLOAD_LIMITS[kind];
  if (size.bytes <= limit) return null;
  const noun = NOUN[kind];
  const smaller =
    kind === "video" ? "Try a shorter clip." : `Try a smaller ${noun}.`;
  return `This ${noun} is ${megabytes(size.bytes)}, and the demo takes ${noun}s up to ${megabytes(limit)}. ${smaller}`;
}
