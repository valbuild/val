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
        const mimeType = Internal.getMimeType(result);
        resolve({
          src: result,
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
