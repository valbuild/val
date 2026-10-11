import { DEFAULT_FONT_ACCEPT, isFontMimeType } from "../mimeType/font";
import { filedir } from "./filedir";
import type { MediaDir } from "./record";

/**
 * Options for `s.fontdir(dir, options)`: everything but the directory, which
 * is the first argument.
 */
export type FontdirOptions = {
  /**
   * The accepted font types. Defaults to every web font format:
   * `"font/woff2,font/woff,font/ttf,font/otf"`. Narrow it to `"font/woff2"` to
   * keep the site's fonts to the one format every current browser reads and
   * that is smallest on the wire.
   */
  accept?: string;
};

/**
 * Options for the deprecated `s.fontset(options)`, which took the directory
 * as `dir`.
 *
 * @deprecated Use `s.fontdir(dir, options)` and `FontdirOptions`.
 */
export type FontsetOptions = FontdirOptions & {
  /**
   * The directory where fonts should be stored.
   * Must start with "/public" (e.g., "/public/val/fonts")
   */
  dir: MediaDir;
};

/**
 * Define a directory of fonts.
 *
 * A fontdir IS a filedir — the same source, the same `s.font(fontsVal)` field
 * to pick from it, the same checks and fixes — with `accept` defaulting to the
 * web font formats. What a font gets that any other file does not is decided
 * by its mime type rather than by the directory: the Studio previews any file
 * it knows is a font, wherever it is shown.
 *
 * Remote is off by default: call `.remote()` on the result to allow remote files.
 *
 * @example
 * ```typescript
 * const schema = s.fontdir("/public/val/fonts");
 * export default c.define("/content/fonts.val.ts", schema, {
 *   "/public/val/fonts/inter_a1b2c.woff2": {
 *     mimeType: "font/woff2",
 *   },
 * });
 * ```
 */
export const fontdir = (
  dir: MediaDir,
  options?: FontdirOptions,
): ReturnType<typeof filedir> => {
  const accept = options?.accept ?? DEFAULT_FONT_ACCEPT;
  const notFonts = accept
    .split(",")
    .map((type) => type.trim())
    .filter((type) => !isFontMimeType(type));
  if (notFonts.length > 0) {
    // A fontdir that took a PDF would be a filedir under a name that says
    // otherwise, and the Studio would draw a specimen of nothing.
    throw new Error(
      `s.fontdir(): 'accept' may only name font types (font/woff2, font/woff, font/ttf, font/otf or font/*). Got: ${notFonts.join(", ")}. Use s.filedir() for other files.`,
    );
  }
  return filedir(dir, { accept });
};

/**
 * Define a collection of fonts.
 *
 * @deprecated Use `s.fontdir(dir, options)`: the directory moved out of the
 * options and into the first argument, and nothing else changed.
 *
 * @example
 * ```typescript
 * // was: s.fontset({ dir: "/public/val/fonts" })
 * const schema = s.fontdir("/public/val/fonts");
 * ```
 */
export const fontset = (options: FontsetOptions): ReturnType<typeof filedir> =>
  fontdir(options.dir, options);
