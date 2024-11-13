import { FileMetadata, ImageMetadata, Internal } from "@valbuild/core";
import sizeOf from "image-size";

const textEncoder = new TextEncoder();
export async function extractImageMetadata(
  filename: string,
  input: Buffer,
): Promise<ImageMetadata> {
  const imageSize = sizeOf(input);
  let mimeType: string | null = null;
  if (imageSize.type) {
    const possibleMimeType = `image/${imageSize.type}`;
    if (Internal.MIME_TYPES_TO_EXT[possibleMimeType]) {
      mimeType = possibleMimeType;
    }
    const filenameBasedLookup = Internal.filenameToMimeType(filename);
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
  return {
    width,
    height,
    mimeType,
  };
}

export async function extractFileMetadata(
  filename: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _input: Buffer, // TODO: use buffer to determine mimetype
): Promise<FileMetadata> {
  let mimeType = Internal.filenameToMimeType(filename);
  if (!mimeType) {
    mimeType = "application/octet-stream";
  }
  return {
    mimeType,
  };
}
