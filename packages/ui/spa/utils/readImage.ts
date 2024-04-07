import { FileMetadata, ImageMetadata, Internal } from "@valbuild/core";
import { ChangeEvent } from "react";
import { getMimeType, mimeTypeToFileExt } from "@valbuild/shared/internal";

const textEncoder = new TextEncoder();

export function readImage(ev: ChangeEvent<HTMLInputElement>) {
  return new Promise<{
    src: string;
    sha256: string;
    width?: number;
    height?: number;
    mimeType?: string;
    fileExt?: string;
    filename?: string;
  }>((resolve, reject) => {
    const imageFile = ev.currentTarget.files?.[0];
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") {
        const image = new Image();
        image.addEventListener("load", () => {
          const sha256 = Internal.getSHA256Hash(textEncoder.encode(result));
          if (image.naturalWidth && image.naturalHeight) {
            const mimeType = getMimeType(result);
            resolve({
              src: result,
              width: image.naturalWidth,
              height: image.naturalHeight,
              filename: imageFile?.name,
              sha256,
              mimeType,
              fileExt: mimeType && mimeTypeToFileExt(mimeType),
            });
          } else {
            resolve({
              src: result,
              filename: imageFile?.name,
              sha256,
            });
          }
        });
        image.src = result;
      } else if (!result) {
        reject({ message: "Empty result" });
      } else {
        reject({ message: "Unexpected image result type", result });
      }
    });
    if (imageFile) {
      reader.readAsDataURL(imageFile);
    }
  });
}

export function createFilename(
  data: string | null,
  filename: string | null,
  metadata: FileMetadata | ImageMetadata | undefined
) {
  if (!metadata) {
    return filename;
  }
  if (!data) {
    return filename;
  }
  const shaSuffix = metadata.sha256.slice(0, 5);
  const mimeType = getMimeType(data) ?? "unknown";
  const newExt = mimeTypeToFileExt(mimeType) ?? "unknown"; // Don't trust the file extension
  if (filename) {
    let cleanFilename = filename.split(".").slice(0, -1).join(".") || filename; // remove extension if it exists
    const maybeShaSuffixPos = cleanFilename.lastIndexOf("_");
    const currentShaSuffix = cleanFilename.slice(
      maybeShaSuffixPos + 1,
      cleanFilename.length
    );
    if (currentShaSuffix === shaSuffix) {
      cleanFilename = cleanFilename.slice(0, maybeShaSuffixPos);
    }
    const escapedFilename = encodeURIComponent(cleanFilename)
      .replace(/%[0-9A-Fa-f]{2}/g, "")
      .toLowerCase();
    return `${escapedFilename}_${shaSuffix}.${newExt}`;
  }
  return `${metadata.sha256}.${newExt}`;
}
