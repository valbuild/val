import { DEFAULT_FONT_ACCEPT, isFontMimeType } from "../mimeType/font";
import { fileset, FilesetOptions } from "./fileset";

/**
 * Options for s.fontset()
 */
export type FontsetOptions = {
  /**
   * The directory where fonts should be stored.
   * Must start with "/public" (e.g., "/public/val/fonts")
   */
  dir: FilesetOptions["dir"];
  /**
   * The accepted font types. Defaults to every web font format:
   * `"font/woff2,font/woff,font/ttf,font/otf"`. Narrow it to `"font/woff2"` to
   * keep the site's fonts to the one format every current browser reads and
   * that is smallest on the wire.
   */
  accept?: string;
};

/**
 * Define a collection of fonts.
 *
 * A fontset IS a fileset — the same source, the same `s.file(fontsVal)` field
 * to pick from it, the same checks and fixes — with `accept` defaulting to the
 * web font formats. What a font gets that any other file does not is decided
 * by its mime type rather than by the set: the Studio previews any file it
 * knows is a font, wherever it is shown.
 *
 * Remote is off by default: call `.remote()` on the result to allow remote files.
 *
 * @example
 * ```typescript
 * const schema = s.fontset({ dir: "/public/val/fonts" });
 * export default c.define("/content/fonts.val.ts", schema, {
 *   "/public/val/fonts/inter_a1b2c.woff2": {
 *     mimeType: "font/woff2",
 *   },
 * });
 * ```
 */
export const fontset = (
  options: FontsetOptions,
): ReturnType<typeof fileset> => {
  const accept = options.accept ?? DEFAULT_FONT_ACCEPT;
  const notFonts = accept
    .split(",")
    .map((type) => type.trim())
    .filter((type) => !isFontMimeType(type));
  if (notFonts.length > 0) {
    // A fontset that took a PDF would be a fileset under a name that says
    // otherwise, and the Studio would draw a specimen of nothing.
    throw new Error(
      `s.fontset(): 'accept' may only name font types (font/woff2, font/woff, font/ttf, font/otf or font/*). Got: ${notFonts.join(", ")}. Use s.fileset() for other files.`,
    );
  }
  return fileset({ dir: options.dir, accept });
};
