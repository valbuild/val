import { Internal } from "@valbuild/core";
import { base64DataUrlToUint8Array } from "@valbuild/shared";
import { ChangeEvent } from "react";

export function readImageFromFile(file: File): Promise<{
  src: string;
  fileHash: string;
  width?: number;
  height?: number;
  mimeType?: string;
  fileExt?: string;
  filename?: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") {
        const image = new Image();
        image.addEventListener("load", () => {
          const binaryData = base64DataUrlToUint8Array(result);
          const fileHash = Internal.getSHA256Hash(binaryData);
          if (image.naturalWidth && image.naturalHeight) {
            const mimeType = Internal.getMimeType(result);
            resolve({
              src: result,
              width: image.naturalWidth,
              height: image.naturalHeight,
              filename: file.name,
              fileHash,
              mimeType,
              fileExt: mimeType && Internal.mimeTypeToFileExt(mimeType),
            });
          } else {
            resolve({
              src: result,
              filename: file.name,
              fileHash,
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
    reader.readAsDataURL(file);
  });
}

export function readImage(ev: ChangeEvent<HTMLInputElement>) {
  return new Promise<{
    src: string;
    fileHash: string;
    width?: number;
    height?: number;
    mimeType?: string;
    fileExt?: string;
    filename?: string;
  }>((resolve, reject) => {
    const imageFile = ev.currentTarget.files?.[0];
    if (!imageFile) {
      reject({ message: "No file selected" });
      return;
    }
    readImageFromFile(imageFile).then(resolve).catch(reject);
  });
}
