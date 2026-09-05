/**
 * What the image tool needs from an image library, and nothing else.
 *
 * The tool is not given `sharp`. It is given these two functions, because
 * that is the whole of what uploading an image needs an image library for:
 * read the dimensions out of the bytes, and re-encode them when the schema
 * asks. Keeping the contract this narrow is what lets the host choose —
 * `sharpImageProcessor` from `@valbuild/mcp/sharp` is the one we ship, and a
 * project that already has an encoder can write its own in twenty lines.
 *
 * It also means this package has no native dependency. `sharp` ships a
 * compiled binary per platform, and a CMS should not put one in every
 * project's install just so that the projects which want image uploads can
 * have them.
 */

export type ValImageProcessorResult = {
  width: number;
  height: number;
  /** e.g. `image/webp`. */
  mimeType: string;
};

export type ValImageEncodeRequest = {
  /** The mime type to convert to, e.g. `image/webp`. */
  mimeType: string;
  /** Between 0 and 1, as `s.image({ encode: { quality } })` states it. */
  quality: number;
  /**
   * The size to scale down to, or `null` when the image already fits inside
   * the schema's bounds. Never an upscale: {@link fitWithin} answers `null`
   * rather than a bigger box.
   */
  resizeTo: { width: number; height: number } | null;
};

export type ValImageProcessor = {
  /**
   * Width, height and mime type of these bytes.
   *
   * `null` when they are not an image this processor can read — which is an
   * answer, not a failure: the tool reports it to the caller as invalid input
   * rather than as an internal error, because that is what it is.
   *
   * Must not throw. A processor that throws is treated as an internal error.
   */
  read(bytes: Uint8Array): Promise<ValImageProcessorResult | null>;
  /**
   * Re-encode, or decline to.
   *
   * `null` means "I could not, upload the original" — the same answer the
   * browser gives when a canvas is unavailable. A failed optimisation must
   * never become a failed upload, so this is a normal outcome and not an
   * error.
   */
  encode(
    bytes: Uint8Array,
    request: ValImageEncodeRequest,
  ): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
};
