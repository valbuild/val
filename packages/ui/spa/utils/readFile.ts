import { Internal } from "@valbuild/core";
import { base64DataUrlToUint8Array } from "@valbuild/shared";
import { ChangeEvent } from "react";

export function readFile(ev: ChangeEvent<HTMLInputElement>) {
  return new Promise<{
    src: string;
    fileHash: string;
    mimeType?: string;
    fileExt?: string;
    filename?: string;
  }>((resolve, reject) => {
    const uploadedFile = ev.currentTarget.files?.[0];
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result === "string") {
        const binaryData = base64DataUrlToUint8Array(result);
        const fileHash = Internal.getSHA256Hash(binaryData);
        const mimeType = Internal.getMimeType(result);
        resolve({
          src: result,
          filename: uploadedFile?.name,
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
    if (uploadedFile) {
      reader.readAsDataURL(uploadedFile);
    }
  });
}
