import { EXT_TO_MIME_TYPES, MIME_TYPES_TO_EXT } from "./all";

const MIME_TYPE_REGEX = /^data:(.*?);base64,/;

export function getMimeType(base64Url: string): string | undefined {
  const match = MIME_TYPE_REGEX.exec(base64Url);
  if (match && match[1]) {
    return match[1];
  }
  return;
}

export function mimeTypeToFileExt(mimeType: string) {
  const recognizedMimeType = MIME_TYPES_TO_EXT[mimeType];
  if (recognizedMimeType) {
    return recognizedMimeType;
  }
  return mimeType.split("/")[1];
}

export function filenameToMimeType(filename: string) {
  const ext = filename.split(".").pop();
  const recognizedExt = ext && EXT_TO_MIME_TYPES[ext];
  if (recognizedExt) {
    return recognizedExt;
  }
}

/**
 * Whether `mimeType` satisfies an `accept` string.
 *
 * `accept` is the HTML file-input syntax: a comma-separated list of exact mime
 * types (`image/png`), type wildcards (`image` followed by `/` and a star) or
 * the catch-all star-slash-star.
 *
 * This lived in three places - `ImageSchema`, `FileSchema` and the media
 * branch of `RecordSchema` - which is how the third copy grew a redundant
 * `image` wildcard case that the general wildcard branch already covered.
 * Anything that has to decide whether an `accept` is satisfied, validation and
 * editor tooling alike, should call this.
 */
export function mimeTypeMatchesAccept(
  mimeType: string,
  accept: string,
): boolean {
  return accept
    .split(",")
    .map((acceptedType) => acceptedType.trim())
    .some((acceptedType) => {
      if (acceptedType === "*/*") {
        return true;
      }
      if (acceptedType.endsWith("/*")) {
        // Keep the slash: dropping it too (`slice(0, -2)`, which is what the
        // image and file copies did) makes "image/*" match "imagex/png". The
        // record copy special-cased "image/*" to avoid exactly that, so this is
        // the strict behaviour of the three, not a fourth.
        return mimeType.startsWith(acceptedType.slice(0, -1));
      }
      return acceptedType === mimeType;
    });
}
