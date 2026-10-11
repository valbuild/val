import { Internal } from "@valbuild/core";

/**
 * A schema's `accept`, as a file input's `accept`.
 *
 * A picker matches mime types through the operating system's own table, and
 * where that table does not know a type the file is greyed out — which is the
 * case for the font types on more than one platform. So each font type also
 * names its extension. Only fonts: elsewhere the mime type alone has always
 * been enough, and an extension can admit a file whose bytes are something
 * else.
 */
export function inputAccept(accept: string | undefined): string | undefined {
  if (!accept) {
    return accept;
  }
  const types = accept.split(",").map((type) => type.trim());
  const extensions = new Set<string>();
  for (const type of types) {
    if (type === "font/*") {
      for (const ext of Object.values(Internal.FONT_MIME_TYPE_EXTENSIONS)) {
        extensions.add(ext);
      }
    } else if (Internal.FONT_MIME_TYPE_EXTENSIONS[type]) {
      extensions.add(Internal.FONT_MIME_TYPE_EXTENSIONS[type]);
    }
  }
  return [...types, ...extensions].join(",");
}

/**
 * Whether a dropped file is one `accept` takes: by the type the browser gave
 * it, or — when that is empty or generic, as it is for fonts on some
 * platforms — by the type its extension names.
 */
export function fileMatchesAccept(
  file: { type: string; name: string },
  accept: string | undefined,
): boolean {
  if (!accept) {
    return true;
  }
  if (file.type && Internal.mimeTypeMatchesAccept(file.type, accept)) {
    return true;
  }
  const byName = Internal.filenameToMimeType(file.name.toLowerCase());
  return !!byName && Internal.mimeTypeMatchesAccept(byName, accept);
}

/**
 * Whether a gallery takes only fonts — an `s.fontset()`, or an `s.fileset()`
 * written to be one. Read off `accept`, because a fontset serializes as the
 * fileset it is and there is nothing else to read it off.
 */
export function isFontAccept(accept: string | undefined): boolean {
  return (
    !!accept &&
    accept.split(",").every((type) => Internal.isFontMimeType(type.trim()))
  );
}
