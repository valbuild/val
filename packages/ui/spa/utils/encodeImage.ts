import type { ImageEncodeOption } from "@valbuild/core";

/**
 * Re-encoding an upload in the browser, before its bytes are hashed.
 *
 * Everything downstream of `readImageFromFile` derives from the bytes it is
 * handed: `Internal.createFilename` picks the extension from the data URL's
 * mime type ("Don't trust the file extension"), the SHA-256 becomes the
 * filename suffix and the remote file hash, and the width/height come from
 * decoding those same bytes. So swapping the file here - and only here - makes
 * the whole pipeline describe what was actually uploaded, with nothing else
 * needing to know. See `architecture/media.md`.
 *
 * The decisions live in the exported pure functions; only {@link encodeImage}
 * touches a canvas, because `packages/ui` has no jsdom and no canvas in jest.
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

const MIME_TYPE_OF: Record<EncodeSettings["type"], string> = {
  webp: "image/webp",
};

/**
 * Formats a canvas cannot round-trip without losing something: SVG is vector,
 * an animated GIF keeps only its first frame, and AVIF is already smaller than
 * anything we would produce.
 */
const NEVER_ENCODED = ["image/svg+xml", "image/gif", "image/avif"];

/**
 * The schema's own option first, then the gallery it references, then off.
 *
 * Mirrors how `ImageField` resolves `accept` and `directory`. A gallery-backed
 * field (`s.image(galleryVal)`) serializes with EMPTY options, so without the
 * gallery fallback it could never inherit what the gallery asked for.
 */
export function resolveEncodeSettings(
  fieldOption: ImageEncodeOption | undefined,
  galleryOption: ImageEncodeOption | undefined,
): EncodeSettings | null {
  const option = fieldOption !== undefined ? fieldOption : galleryOption;
  if (!option) {
    return null;
  }
  return {
    type: option.type,
    quality: option.quality ?? ENCODE_DEFAULTS.quality,
    maxWidth: option.maxWidth ?? ENCODE_DEFAULTS.maxWidth,
    maxHeight: option.maxHeight ?? ENCODE_DEFAULTS.maxHeight,
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
 * mimeType against `accept` - so converting to a type `accept` forbids would
 * upload a file the schema reports as invalid the moment it lands.
 */
export function isMimeTypeAccepted(
  mimeType: string,
  accept: string | undefined,
): boolean {
  if (!accept) {
    return true;
  }
  return accept
    .split(",")
    .map((type) => type.trim())
    .some((acceptedType) => {
      if (acceptedType === "*/*") {
        return true;
      }
      if (acceptedType.endsWith("/*")) {
        return mimeType.startsWith(acceptedType.slice(0, -2));
      }
      return acceptedType === mimeType;
    });
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
 * Whether to upload what the canvas produced, or the file the editor picked.
 *
 * Two ways the encoded bytes lose. They are not actually the type we asked for
 * - `canvas.toBlob` answers an unsupported type with a PNG rather than with
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

/** `photo.png` -> `photo.webp`. The extension is re-derived downstream too, but the name should not lie. */
function withExtension(filename: string, ext: string): string {
  const base = filename.split(".").slice(0, -1).join(".") || filename;
  return `${base}.${ext}`;
}

function toBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
}

/**
 * Convert an upload, or hand back exactly what was passed in.
 *
 * Never throws and never rejects: a failed optimisation must not become a
 * failed upload.
 */
export async function encodeImage(
  file: File,
  settings: EncodeSettings | null,
  accept: string | undefined,
): Promise<File> {
  if (settings === null) {
    return file;
  }
  const targetMimeType = MIME_TYPE_OF[settings.type];
  if (NEVER_ENCODED.includes(file.type)) {
    return file;
  }
  if (!isMimeTypeAccepted(targetMimeType, accept)) {
    // `accept` wins: it is what validation checks the stored mimeType against.
    return file;
  }
  // Decoded ONLY through createImageBitmap, for `imageOrientation`. It is what
  // applies EXIF rotation, and the webp we write carries no EXIF - so decoding
  // through an <img> instead would silently rotate portrait photos. Uploading
  // the original is strictly better than uploading a rotated one.
  if (typeof createImageBitmap !== "function") {
    return file;
  }
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const target = fitWithin(
      bitmap.width,
      bitmap.height,
      settings.maxWidth,
      settings.maxHeight,
    );
    const needsDownscale = target !== null;
    if (isSkippedSource(file.type, targetMimeType, needsDownscale)) {
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = target?.width ?? bitmap.width;
    canvas.height = target?.height ?? bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await toBlob(canvas, targetMimeType, settings.quality);
    // The null check is `chooseEncoded`'s job too, but it answers a boolean and
    // TypeScript cannot narrow `blob` through that, so it is asked here as well.
    if (
      !blob ||
      !chooseEncoded({
        originalSize: file.size,
        encodedSize: blob.size,
        encodedType: blob.type,
        targetMimeType,
        needsDownscale,
      })
    ) {
      return file;
    }
    return new File([blob], withExtension(file.name, settings.type), {
      type: targetMimeType,
    });
  } catch (err) {
    console.error("Could not re-encode image, uploading the original", err);
    return file;
  } finally {
    bitmap?.close();
  }
}
