const MIME_TYPE_REGEX =
  /^data:(image\/(png|jpeg|jpg|gif|webp|bmp|tiff|ico|svg\+xml));base64,/;

export function getMimeType(base64Url: string): string | undefined {
  const match = MIME_TYPE_REGEX.exec(base64Url);
  if (match && match[1]) {
    return match[1];
  }
  return;
}

export function mimeTypeToFileExt(mimeType: string) {
  if (mimeType === "image/svg+xml") {
    return "svg";
  }
  if (mimeType === "image/vnd.microsoft.icon") {
    return "ico";
  }
  if (mimeType.startsWith("image/")) {
    return mimeType.slice("image/".length);
  }
  return mimeType;
}
