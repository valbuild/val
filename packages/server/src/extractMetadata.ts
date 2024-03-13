import { FileMetadata, ImageMetadata, Internal } from "@valbuild/core";
import sizeOf from "image-size";
import {
  filenameToMimeType,
  MIME_TYPES_TO_EXT,
} from "@valbuild/shared/internal";

const textEncoder = new TextEncoder();
export async function extractImageMetadata(
  filename: string,
  input: Buffer
): Promise<ImageMetadata> {
  console.log({ filename, input });
  const imageSize = sizeOf(input);
  let mimeType: string | null = null;
  if (imageSize.type) {
    const possibleMimeType = `image/${imageSize.type}`;
    if (MIME_TYPES_TO_EXT[possibleMimeType]) {
      mimeType = possibleMimeType;
    }
    const filenameBasedLookup = filenameToMimeType(filename);
    if (filenameBasedLookup) {
      mimeType = filenameBasedLookup;
    }
  }
  if (!mimeType) {
    mimeType = "application/octet-stream";
  }
  let { width, height } = imageSize;
  if (!width || !height) {
    width = 0;
    height = 0;
  }

  const sha256 = getSha256(mimeType, input);
  return {
    width,
    height,
    sha256,
    mimeType,
  };
}

function getSha256(mimeType: string, input: Buffer): string {
  return Internal.getSHA256Hash(
    textEncoder.encode(
      // TODO: we should probably store the mimetype in the metadata and reuse it here
      `data:${mimeType};base64,${input.toString("base64")}`
    )
  );
}

export async function extractFileMetadata(
  filename: string,
  input: Buffer
): Promise<FileMetadata> {
  let mimeType = filenameToMimeType(filename);
  if (!mimeType) {
    mimeType = "application/octet-stream";
  }
  const sha256 = getSha256(mimeType, input);
  return {
    sha256,
    mimeType,
  };
}
