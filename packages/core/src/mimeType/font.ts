/**
 * Fonts, as far as a mime type can tell.
 *
 * The four web formats have IANA types under `font/` (RFC 8081), and those are
 * what Val stores. Browsers and operating systems disagree about them: a file
 * picker reports `.woff2` as `font/woff2`, `application/font-woff2` or nothing
 * at all depending on the platform, and nothing at all reads as
 * `application/octet-stream` once the file is a data URL. That is why an upload
 * asks the BYTES ({@link sniffFontMimeType}) rather than trusting the picker.
 */

/** The formats `s.fontset()` accepts unless told otherwise, best first. */
export const FONT_MIME_TYPES = [
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
] as const;

/** `s.fontset()`'s `accept` when none is given. */
export const DEFAULT_FONT_ACCEPT = FONT_MIME_TYPES.join(",");

/**
 * The extension of each font type, for a file input: a picker matches an
 * `accept` of mime types through the operating system's own table, and where
 * that table does not know `font/woff2` the file is greyed out.
 */
export const FONT_MIME_TYPE_EXTENSIONS: Record<string, string> = {
  "font/woff2": ".woff2",
  "font/woff": ".woff",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
  "font/collection": ".ttc",
};

/**
 * The names the extension table used for fonts before it used RFC 8081's.
 * Content written then still carries them, and it is the same file.
 */
const LEGACY_FONT_MIME_TYPES: Record<string, string> = {
  "application/x-font-ttf": "font/ttf",
  "application/x-font-otf": "font/otf",
  "application/x-font-woff": "font/woff",
};

/** `mimeType`, with a legacy font name read as its `font/` type. */
export function canonicalFontMimeType(mimeType: string): string {
  return LEGACY_FONT_MIME_TYPES[mimeType] ?? mimeType;
}

/**
 * Whether a file of `mimeType` is a font a browser can draw: the `font/` types,
 * and the pre-RFC 8081 names still found in older data.
 */
export function isFontMimeType(mimeType: string | null | undefined): boolean {
  if (!mimeType) {
    return false;
  }
  return (
    mimeType.startsWith("font/") ||
    mimeType.startsWith("application/x-font-") ||
    mimeType === "application/font-woff" ||
    mimeType === "application/font-woff2" ||
    mimeType === "application/font-sfnt" ||
    mimeType === "application/vnd.ms-opentype"
  );
}

/**
 * The font type of `bytes`, read from the signature every font format starts
 * with, or `null` when they are not a font.
 *
 * Only the first four bytes are needed: the WOFF signatures (`wOFF`, `wOF2`),
 * the SFNT versions of TrueType (`0x00010000`, or `true` from old Apple fonts)
 * and of CFF-flavoured OpenType (`OTTO`), and a collection's tag (`ttcf`).
 */
export function sniffFontMimeType(bytes: Uint8Array): string | null {
  if (bytes.length < 4) {
    return null;
  }
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  switch (tag) {
    case "wOF2":
      return "font/woff2";
    case "wOFF":
      return "font/woff";
    case "OTTO":
      return "font/otf";
    case "true":
    case "\u0000\u0001\u0000\u0000":
      return "font/ttf";
    case "ttcf":
      return "font/collection";
    default:
      return null;
  }
}
