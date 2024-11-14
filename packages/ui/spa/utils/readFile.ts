import { Internal } from "@valbuild/core";
import { ChangeEvent } from "react";

const textEncoder = new TextEncoder();

export function readFile(ev: ChangeEvent<HTMLInputElement>) {
  return new Promise<{
    src: string;
    sha256: string;
    mimeType?: string;
    fileExt?: string;
    filename?: string;
  }>((resolve, reject) => {
    const uploadedFile = ev.currentTarget.files?.[0];
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") {
        const sha256 = Internal.getSHA256Hash(textEncoder.encode(result));
        const mimeType = Internal.getMimeType(result);
        resolve({
          src: result,
          filename: uploadedFile?.name,
          sha256,
          mimeType,
          fileExt: mimeType && Internal.mimeTypeToFileExt(mimeType),
        });
      } else if (!result) {
        reject({ message: "Empty result" });
      } else {
        reject({ message: "Unexpected file result type", result });
      }
    });
    if (uploadedFile) {
      reader.readAsDataURL(uploadedFile);
    }
  });
}
