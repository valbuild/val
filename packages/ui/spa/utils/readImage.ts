import { Internal } from "@valbuild/core";
import { base64DataUrlToUint8Array } from "@valbuild/shared";
import { ChangeEvent } from "react";
import { encodeImage, EncodeSettings } from "./encodeImage";

/**
 * What the schema asked for, resolved. `settings: null` is "upload as picked".
 */
export type ReadImageEncode = {
  settings: EncodeSettings | null;
  accept: string | undefined;
};

export type ReadImageResult = {
  src: string;
  fileHash: string;
  width?: number;
  height?: number;
  mimeType?: string;
  fileExt?: string;
  filename?: string;
};

/**
 * Read an image for upload, re-encoding it first when the schema asks.
 *
 * The conversion has to happen BEFORE the hash below: the SHA-256 becomes the
 * filename suffix and the remote file hash, so hashing the original and
 * uploading something else would name the file after bytes nobody has.
 *
 * Deliberately NOT an `async function`. Encoding is off by default, and an
 * `await` on the way to a `settings: null` no-op would still push the
 * `FileReader` onto a later microtask than the caller's own next statement —
 * a timing change to every upload in the Studio, bought for a branch that does
 * nothing. The default path therefore starts the read synchronously, exactly as
 * it did before this option existed.
 */
export function readImageFromFile(
  file: File,
  encode?: ReadImageEncode,
): Promise<ReadImageResult> {
  if (!encode || encode.settings === null) {
    return readDecodedImage(file);
  }
  return encodeImage(file, encode.settings, encode.accept).then(
    readDecodedImage,
  );
}

function readDecodedImage(file: File): Promise<ReadImageResult> {
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

export function readImage(
  ev: ChangeEvent<HTMLInputElement>,
  encode?: ReadImageEncode,
) {
  return new Promise<ReadImageResult>((resolve, reject) => {
    const imageFile = ev.currentTarget.files?.[0];
    if (!imageFile) {
      reject({ message: "No file selected" });
      return;
    }
    readImageFromFile(imageFile, encode).then(resolve).catch(reject);
  });
}
