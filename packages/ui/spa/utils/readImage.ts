import { Internal } from "@valbuild/core";
import { ChangeEvent } from "react";
import { Buffer } from "buffer";

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
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") {
        const image = new Image();
        image.addEventListener("load", () => {
          const binaryData = Buffer.from(result.split(",")[1], "base64");
          const fileHash = Internal.getSHA256Hash(binaryData);
          if (image.naturalWidth && image.naturalHeight) {
            const mimeType = Internal.getMimeType(result);
            resolve({
              src: result,
              width: image.naturalWidth,
              height: image.naturalHeight,
              filename: imageFile?.name,
              fileHash,
              mimeType,
              fileExt: mimeType && Internal.mimeTypeToFileExt(mimeType),
            });
          } else {
            resolve({
              src: result,
              filename: imageFile?.name,
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
    if (imageFile) {
      reader.readAsDataURL(imageFile);
    }
  });
}
