import { Internal } from "@valbuild/core";
import type {
  ValImageEncodeRequest,
  ValImageProcessor,
  ValImageProcessorResult,
} from "../images/types";

/**
 * `sharp`, as the image tool wants it.
 *
 * The library is passed IN rather than imported, and that is the whole point of
 * this file existing separately. `sharp` ships a compiled binary per platform;
 * importing it here would put one in every project that installs Val, for a
 * feature most of them will not mount. Instead the project installs `sharp`
 * itself and writes:
 *
 * ```ts
 * import sharp from "sharp";
 * import { createValImageTools } from "@valbuild/mcp";
 * import { sharpImageProcessor } from "@valbuild/mcp/sharp";
 *
 * const tools = createValImageTools(sharpImageProcessor(sharp));
 * ```
 *
 * The parameter is typed structurally — {@link SharpLike} — rather than as
 * `import("sharp")`, for the same reason: a type-only import of a package that
 * is not installed is still a compile error, and this package must typecheck in
 * a project that has never heard of sharp. The real `sharp` satisfies it, and
 * `sharpImageProcessor.test.ts` asserts as much against the actual library so
 * the structural type cannot drift away from it unnoticed.
 */

/** What `sharp(bytes)` gives back, narrowed to what this file calls. */
export type SharpPipelineLike = {
  metadata(): Promise<{
    width?: number | undefined;
    height?: number | undefined;
    format?: string | undefined;
  }>;
  resize(options: {
    width?: number | undefined;
    height?: number | undefined;
    fit?: "inside" | undefined;
    withoutEnlargement?: boolean | undefined;
  }): SharpPipelineLike;
  rotate(): SharpPipelineLike;
  webp(options: { quality?: number | undefined }): SharpPipelineLike;
  toBuffer(): Promise<Buffer>;
};

export type SharpLike = (input: Uint8Array) => SharpPipelineLike;

/**
 * Which sharp formats are worth calling an image.
 *
 * Mapped explicitly rather than by pasting `image/` in front of
 * `metadata.format`, because sharp's names and the mime types disagree in the
 * cases that matter — `jpeg` vs `image/jpeg` is fine, but `heif` covers AVIF,
 * and `svg` is a format sharp reads and Val stores as text. An unmapped format
 * is reported as "not an image this library can read", which is the honest
 * answer and is recoverable: the caller can convert it themselves.
 */
const MIME_TYPE_OF_FORMAT: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  jp2: "image/jp2",
  png: "image/png",
  svg: "image/svg+xml",
  tiff: "image/tiff",
  webp: "image/webp",
};

export function sharpImageProcessor(sharp: SharpLike): ValImageProcessor {
  return {
    async read(bytes: Uint8Array): Promise<ValImageProcessorResult | null> {
      let metadata: Awaited<ReturnType<SharpPipelineLike["metadata"]>>;
      try {
        metadata = await sharp(bytes).metadata();
      } catch {
        // sharp rejects on anything it cannot parse. That is not an internal
        // failure — it is the answer to "is this an image", and the tool turns
        // a null into a message the caller can act on.
        return null;
      }
      const { width, height, format } = metadata;
      if (!width || !height || !format) {
        return null;
      }
      const mimeType = MIME_TYPE_OF_FORMAT[format];
      if (!mimeType) {
        return null;
      }
      // Cross-checked against Val's own table, which is what decides the stored
      // file's extension. A mime type this side knows and that side does not
      // would produce a file named `.unknown`.
      if (!Internal.MIME_TYPES_TO_EXT[mimeType]) {
        return null;
      }
      return { width, height, mimeType };
    },

    async encode(
      bytes: Uint8Array,
      request: ValImageEncodeRequest,
    ): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
      if (request.mimeType !== "image/webp") {
        // The only target `ImageEncodeOptions.type` can name today. Declining
        // rather than throwing keeps the "a failed optimisation is not a failed
        // upload" rule true if a second format is added here later than there.
        return null;
      }
      try {
        // `rotate()` with no argument applies the EXIF orientation, and it has
        // to be here: the WebP carries no EXIF, so a rotation the source only
        // described would otherwise be lost and the image would land on its
        // side. It is also what makes the dimensions the tool re-reads
        // afterwards the ones a browser would show.
        let pipeline = sharp(bytes).rotate();
        if (request.resizeTo) {
          pipeline = pipeline.resize({
            width: request.resizeTo.width,
            height: request.resizeTo.height,
            fit: "inside",
            // Belt and braces: `fitWithin` never asks for an upscale, and this
            // means a future caller that does cannot get one either.
            withoutEnlargement: true,
          });
        }
        const encoded = await pipeline
          // sharp takes 1-100 where the schema (and `canvas.toBlob`) say 0-1.
          .webp({ quality: Math.round(request.quality * 100) })
          .toBuffer();
        return { bytes: new Uint8Array(encoded), mimeType: "image/webp" };
      } catch {
        return null;
      }
    },
  };
}
