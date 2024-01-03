import { EXT_TO_MIME_TYPES, MIME_TYPES_TO_EXT } from "./all";

const MIME_TYPE_REGEX = /^data:(.*?);base64,/;

export function getMimeType(base64Url: string): string | undefined {
  const match = MIME_TYPE_REGEX.exec(base64Url);
  if (match && match[0]) {
    return match[0];
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
