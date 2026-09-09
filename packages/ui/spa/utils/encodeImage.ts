import {
  chooseEncoded,
  ENCODE_MIME_TYPE_OF,
  fitWithin,
  isMimeTypeAccepted,
  isSkippedSource,
  NEVER_ENCODED,
  withExtension,
  type EncodeSettings,
} from "@valbuild/shared/internal";

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
 * Only the canvas is left in this file. Every *decision* the re-encode makes
 * lives in `@valbuild/shared/internal` instead, because the MCP image tool
 * makes the same ones against `sharp` in a Node process — and `s.image({
 * encode })` has to mean one thing whichever side of the wire ran it.
 */

export {
  ENCODE_DEFAULTS,
  chooseEncoded,
  fitWithin,
  isMimeTypeAccepted,
  isSkippedSource,
  resolveEncodeSettings,
  type EncodeSettings,
} from "@valbuild/shared/internal";

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
  const targetMimeType = ENCODE_MIME_TYPE_OF[settings.type];
  if (NEVER_ENCODED.includes(file.type)) {
    return file;
  }
  if (!isMimeTypeAccepted(targetMimeType, accept)) {
    // `accept` wins: it is what validation checks the stored mimeType against.
    return file;
  }
  // Decoded through createImageBitmap with `imageOrientation` asked for
  // explicitly, because the webp we write carries no EXIF: whatever rotation
  // the source described has to be baked into the pixels here or it is lost.
  //
  // Chromium applies EXIF on every decode path anyway - measured, an <img> and
  // both `imageOrientation` values all report the same oriented size - so this
  // is not the difference between right and rotated THERE. It is a guarantee
  // asked for rather than inherited, which is what makes it portable, and it is
  // why an engine without `createImageBitmap` re-encodes nothing at all:
  // uploading the original beats uploading one silently rotated.
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
