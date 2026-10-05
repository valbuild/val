/**
 * The heights to encode: the ones the upload can fill, tallest first, and the
 * upload's own height when it is shorter than every one of them. Never an
 * upscale — a 480p phone clip does not become a blurry 1080p one.
 */
export function renditionHeights(
  requested: readonly number[],
  sourceHeight: number,
): number[] {
  const fitting = Array.from(
    new Set(requested.filter((height) => height > 0 && height <= sourceHeight)),
  ).sort((a, b) => b - a);
  if (fitting.length > 0) {
    return fitting;
  }
  return [sourceHeight];
}

/**
 * Whether this browser can even try.
 *
 * WebCodecs exists only in a secure context, so a Studio opened over plain
 * `http://` on a LAN address has no encoder at all — that is not a failure of
 * the upload, and the original file goes up instead.
 */
export function canTranscodeVideo(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof globalThis.isSecureContext === "boolean" &&
    globalThis.isSecureContext &&
    "VideoEncoder" in globalThis &&
    "VideoDecoder" in globalThis
  );
}
