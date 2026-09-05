import { Internal, type ImageEncodeOption } from "@valbuild/core";

/**
 * Every decision `encode` makes, with none of the pixels.
 *
 * The re-encode itself happens in two places that share nothing: the Studio
 * runs it on a `<canvas>` before the upload leaves the browser
 * (`packages/ui/spa/utils/encodeImage.ts`), and the MCP image tool runs it on
 * `sharp` in the server process (`@valbuild/mcp`). What must NOT differ between
 * them is what `s.image({ encode })` means — which images are converted, how
 * far they are scaled, and when the original wins anyway. So the decisions live
 * here, once, and each side supplies only its own encoder.
 *
 * See `architecture/media.md`.
 */

export type EncodeSettings = {
  type: "webp";
  quality: number;
  maxWidth: number;
  maxHeight: number;
};

export const ENCODE_DEFAULTS: Omit<EncodeSettings, "type"> = {
  quality: 0.8,
  maxWidth: 2560,
  maxHeight: 2560,
};

export const ENCODE_MIME_TYPE_OF: Record<EncodeSettings["type"], string> = {
  webp: "image/webp",
};

/**
 * Formats an encoder cannot round-trip without losing something: SVG is vector,
 * an animated GIF keeps only its first frame, and AVIF is already smaller than
 * anything we would produce.
 */
export const NEVER_ENCODED = ["image/svg+xml", "image/gif", "image/avif"];

/** A dimension bound the encoder can act on, else the default. */
function usableBound(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/**
 * The schema's own option first, then the gallery it references, then off.
 *
 * Mirrors how `ImageField` resolves `accept` and `directory`. A gallery-backed
 * field (`s.image(galleryVal)`) serializes with EMPTY options, so without the
 * gallery fallback it could never inherit what the gallery asked for — and
 * `s.image(galleryVal, { encode: false })` is how such a field opts back out.
 *
 * Nonsense numbers fall back to the defaults rather than through. `fitWithin`
 * reads a bound of 0 (or NaN, or a negative) as "everything already fits", so
 * an unusable `maxWidth` would otherwise SILENTLY disable the downscale it was
 * asking for, and a `quality` outside 0–1 is ignored by `canvas.toBlob` just as
 * quietly. Falling back is deliberately not throwing: a schema is evaluated by
 * the CLI's `node:vm` sandbox and by the Next server, so a typo'd quality would
 * take a whole project down over an upload-time optimisation.
 */
export function resolveEncodeSettings(
  fieldOption: ImageEncodeOption | undefined,
  galleryOption: ImageEncodeOption | undefined,
): EncodeSettings | null {
  const option = fieldOption !== undefined ? fieldOption : galleryOption;
  if (!option) {
    return null;
  }
  const quality = option.quality;
  return {
    type: option.type,
    quality:
      quality !== undefined && Number.isFinite(quality) && quality > 0
        ? Math.min(quality, 1)
        : ENCODE_DEFAULTS.quality,
    maxWidth: usableBound(option.maxWidth, ENCODE_DEFAULTS.maxWidth),
    maxHeight: usableBound(option.maxHeight, ENCODE_DEFAULTS.maxHeight),
  };
}

/**
 * Dimensions scaled to fit inside the box, or null when the image already does.
 *
 * Null is the signal for "no downscale was needed", which the size comparison
 * in {@link chooseEncoded} turns on.
 */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } | null {
  if (
    !(width > 0) ||
    !(height > 0) ||
    !(maxWidth > 0) ||
    !(maxHeight > 0) ||
    (width <= maxWidth && height <= maxHeight)
  ) {
    return null;
  }
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    // At least one pixel: a very wide, very short image would otherwise round
    // its height to zero, and a zero-sized canvas cannot be encoded.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether a schema that declares `accept` would take this mime type.
 *
 * The same rules as `ImageSchema.executeValidate`, which validates the STORED
 * mimeType against `accept` — so converting to a type `accept` forbids would
 * upload a file the schema reports as invalid the moment it lands. Delegated to
 * `@valbuild/core` rather than re-spelled, because a second reading of one
 * `accept` string is how a converted image passes here and fails there.
 */
export function isMimeTypeAccepted(
  mimeType: string,
  accept: string | undefined,
): boolean {
  if (!accept) {
    return true;
  }
  return Internal.mimeTypeMatchesAccept(mimeType, accept);
}

/** Formats left alone: the lossy list, plus the target type when it already fits. */
export function isSkippedSource(
  sourceMimeType: string,
  targetMimeType: string,
  needsDownscale: boolean,
): boolean {
  if (NEVER_ENCODED.includes(sourceMimeType)) {
    return true;
  }
  return sourceMimeType === targetMimeType && !needsDownscale;
}

/**
 * Whether to upload what the encoder produced, or the file that was picked.
 *
 * Two ways the encoded bytes lose. They are not actually the type we asked for
 * — `canvas.toBlob` answers an unsupported type with a PNG rather than with
 * null, so "not null" is not the same question as "is a webp". Or they are
 * simply bigger, which happens for small and flat images: measured, an 8x8
 * solid PNG of 74 bytes becomes a 548 byte webp. A downscale overrides that,
 * since the original is then the wrong size whatever it weighs.
 */
export function chooseEncoded(input: {
  originalSize: number;
  encodedSize: number | null;
  encodedType: string | null;
  targetMimeType: string;
  needsDownscale: boolean;
}): boolean {
  if (
    input.encodedSize === null ||
    input.encodedType !== input.targetMimeType
  ) {
    return false;
  }
  if (input.needsDownscale) {
    return true;
  }
  return input.encodedSize < input.originalSize;
}

/**
 * `photo.png` -> `photo.webp`. The extension is re-derived downstream too, but
 * the name should not lie.
 */
export function withExtension(filename: string, ext: string): string {
  const base = filename.split(".").slice(0, -1).join(".") || filename;
  return `${base}.${ext}`;
}
