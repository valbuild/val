import {
  chooseEncoded,
  ENCODE_MIME_TYPE_OF,
  fallbackMimeType,
  fitWithin,
  isMimeTypeAccepted,
  isSkippedSource,
  NEVER_ENCODED,
  shouldEncodeWithWasm,
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
 *
 * Three encoders are tried, in order, on the same drawn canvas: the canvas's
 * own, libwebp in WebAssembly where the canvas cannot write WebP (Safari; see
 * `webpWasm.ts`), and the source's own format, scaled down, where that could
 * not be loaded either. Each is the next one's fallback, and the original file
 * is the last.
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
 * What this page's canvas hands back when asked for a type it cannot write,
 * by the type asked for.
 *
 * Learned from the first upload and never asked again: Safari answers
 * `toBlob(cb, "image/webp")` by encoding the whole canvas as a PNG, which is
 * thrown away, so asking on every upload would cost each photo a full PNG
 * encode before the WebAssembly one even starts. What a canvas can write does
 * not change while the page is open.
 */
const canvasCannotWrite = new Map<string, string>();

/**
 * Encoded bytes as the file to upload, or null when the original should win.
 *
 * The null check is `chooseEncoded`'s job too, but it answers a boolean and
 * TypeScript cannot narrow `blob` through that, so it is asked here as well.
 */
function chosenFile(
  blob: Blob | null,
  file: File,
  mimeType: string,
  settings: EncodeSettings,
  needsDownscale: boolean,
): File | null {
  if (
    !blob ||
    !chooseEncoded({
      originalSize: file.size,
      encodedSize: blob.size,
      encodedType: blob.type,
      targetMimeType: mimeType,
      needsDownscale,
    })
  ) {
    return null;
  }
  const ext = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  return new File([blob], withExtension(file.name, ext ?? settings.type), {
    type: mimeType,
  });
}

/**
 * The drawn canvas as WebP, by libwebp in WebAssembly; null when that cannot
 * be loaded or fails.
 *
 * The pixels are read off the canvas that was already drawn, so the decode,
 * the orientation and the resize are exactly the ones the canvas's own encoder
 * was handed. The import is dynamic so that the encoder's JavaScript is a chunk
 * of its own, and is only requested here.
 */
async function encodeWithWasm(
  ctx: CanvasRenderingContext2D,
  quality: number,
): Promise<Blob | null> {
  try {
    const { encodeWebpWithWasm } = await import("./webpWasm");
    const pixels = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
    return await encodeWebpWithWasm(pixels, quality);
  } catch (err) {
    console.warn(
      "Could not encode WebP with WebAssembly, falling back to the canvas",
      err,
    );
    return null;
  }
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

    let canvasOutputType = canvasCannotWrite.get(targetMimeType) ?? null;
    if (canvasOutputType === null) {
      const canvasBlob = await toBlob(canvas, targetMimeType, settings.quality);
      const encoded = chosenFile(
        canvasBlob,
        file,
        targetMimeType,
        settings,
        needsDownscale,
      );
      if (encoded !== null) {
        return encoded;
      }
      canvasOutputType = canvasBlob?.type ?? null;
      if (canvasOutputType !== null && canvasOutputType !== targetMimeType) {
        canvasCannotWrite.set(targetMimeType, canvasOutputType);
      }
    }
    if (shouldEncodeWithWasm({ targetMimeType, canvasOutputType })) {
      const fromWasm = chosenFile(
        await encodeWithWasm(ctx, settings.quality),
        file,
        targetMimeType,
        settings,
        needsDownscale,
      );
      if (fromWasm !== null) {
        return fromWasm;
      }
    }
    // Nothing wrote the type asked for (or what was written lost to the
    // original): scale it down in its own format instead, when it needs it.
    // See `fallbackMimeType`.
    const fallback = fallbackMimeType(file.type, needsDownscale, accept);
    if (fallback === null) {
      return file;
    }
    return (
      chosenFile(
        await toBlob(canvas, fallback, settings.quality),
        file,
        fallback,
        settings,
        needsDownscale,
      ) ?? file
    );
  } catch (err) {
    console.error("Could not re-encode image, uploading the original", err);
    return file;
  } finally {
    bitmap?.close();
  }
}
