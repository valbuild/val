import { Internal } from "@valbuild/core";
import { ChangeEvent } from "react";

const textEncoder = new TextEncoder();

export function readImage(ev: ChangeEvent<HTMLInputElement>) {
  return new Promise<{
    src: string;
    sha256: string;
    width?: number;
    height?: number;
    mimeType?: string;
    fileExt?: string;
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
            console.log(result.slice(0, 30), mimeType);
            resolve({
              src: result,
              width: image.naturalWidth,
              height: image.naturalHeight,
              sha256,
              mimeType,
              fileExt: mimeType && mimeTypeToFileExt(mimeType),
            });
          } else {
            resolve({
              src: result,
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

const MIME_TYPE_REGEX =
  /^data:(image\/(png|jpeg|jpg|gif|webp|bmp|tiff|ico|svg\+xml));base64,/;

function getMimeType(base64Url: string): string | undefined {
  const match = MIME_TYPE_REGEX.exec(base64Url);
  if (match && match[1]) {
    return match[1];
  }
  return;
}

function mimeTypeToFileExt(mimeType: string) {
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
