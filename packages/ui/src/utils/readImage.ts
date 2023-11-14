import { Internal } from "@valbuild/core";
import { ChangeEvent } from "react";
import { getMimeType, mimeTypeToFileExt } from "./imageMimeType";

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
        image.addEventListener("load", async () => {
          const sha256 = await Internal.getSHA256Hash(
            textEncoder.encode(result)
          );
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
