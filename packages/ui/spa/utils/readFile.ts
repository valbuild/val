import { Internal } from "@valbuild/core";
import { base64DataUrlToUint8Array } from "@valbuild/shared";
import { ChangeEvent } from "react";

export function readFileFromFile(file: File): Promise<{
  src: string;
  fileHash: string;
  mimeType?: string;
  fileExt?: string;
  filename?: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") {
        const binaryData = base64DataUrlToUint8Array(result);
        const fileHash = Internal.getSHA256Hash(binaryData);
        const src = withFontMimeType(result, binaryData);
        const mimeType = Internal.getMimeType(src);
        resolve({
          src,
          filename: file.name,
          fileHash,
          mimeType,
          fileExt: mimeType && Internal.mimeTypeToFileExt(mimeType),
        });
      } else if (!result) {
        reject({ message: "Empty result" });
      } else {
        reject({ message: "Unexpected file result type", result });
      }
    });
    reader.readAsDataURL(file);
  });
}

export function readFile(ev: ChangeEvent<HTMLInputElement>) {
  return new Promise<{
    src: string;
    fileHash: string;
    mimeType?: string;
    fileExt?: string;
    filename?: string;
  }>((resolve, reject) => {
    const uploadedFile = ev.currentTarget.files?.[0];
    if (!uploadedFile) {
      reject({ message: "No file selected" });
      return;
    }
    readFileFromFile(uploadedFile).then(resolve).catch(reject);
  });
}

/**
 * `dataUrl`, typed by its bytes when they are a font.
 *
 * The type a data URL carries is the one the picker reported, and for fonts
 * that is unreliable: empty (which reads as `application/octet-stream`) on some
 * platforms, a pre-RFC 8081 `application/x-font-ttf` on others. It decides the
 * stored `mimeType` AND the filename's extension (`createFilename`), so a font
 * typed by the picker could be stored as `inter_a1b2c.octet-stream`. The bytes
 * are not touched, so the hash is the same either way.
 */
export function withFontMimeType(dataUrl: string, bytes: Uint8Array): string {
  const sniffed = Internal.sniffFontMimeType(bytes);
  const current = Internal.getMimeType(dataUrl);
  if (!sniffed || sniffed === current) {
    return dataUrl;
  }
  const comma = dataUrl.indexOf(";base64,");
  if (comma === -1) {
    return dataUrl;
  }
  return `data:${sniffed}${dataUrl.slice(comma)}`;
}
