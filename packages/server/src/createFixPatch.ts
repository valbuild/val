import {
  FILE_REF_PROP,
  FileMetadata,
  ImageMetadata,
  Internal,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { Patch, sourceToPatchPath } from "@valbuild/core/patch";
import sizeOf from "image-size";
import path from "path";
import fs from "fs";
import {
  filenameToMimeType,
  MIME_TYPES_TO_EXT,
} from "@valbuild/shared/internal";

// TODO: find a better name? transformFixesToPatch?
const textEncoder = new TextEncoder();
export async function createFixPatch(
  config: { projectRoot: string },
  apply: boolean,
  sourcePath: SourcePath,
  validationError: ValidationError
): Promise<{ patch: Patch; remainingErrors: ValidationError[] } | undefined> {
  async function getImageMetadata(): Promise<ImageMetadata> {
    const maybeRef =
      validationError.value &&
      typeof validationError.value === "object" &&
      FILE_REF_PROP in validationError.value &&
      typeof validationError.value[FILE_REF_PROP] === "string"
        ? validationError.value[FILE_REF_PROP]
        : undefined;

    if (!maybeRef) {
      // TODO:
      throw Error("Cannot fix image without a file reference");
    }
    const filename = path.join(config.projectRoot, maybeRef);
    const buffer = fs.readFileSync(filename);
    const imageSize = sizeOf(buffer);
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
      throw Error("Cannot determine mimetype of image");
    }
    const { width, height } = imageSize;
    if (!width || !height) {
      throw Error("Cannot determine image size");
    }

    const sha256 = Internal.getSHA256Hash(
      textEncoder.encode(
        // TODO: we should probably store the mimetype in the metadata and reuse it here
        `data:${mimeType};base64,${buffer.toString("base64")}`
      )
    );
    return {
      width,
      height,
      sha256,
      mimeType,
    };
  }
  async function getFileMetadata(): Promise<FileMetadata> {
    const maybeRef =
      validationError.value &&
      typeof validationError.value === "object" &&
      FILE_REF_PROP in validationError.value &&
      typeof validationError.value[FILE_REF_PROP] === "string"
        ? validationError.value[FILE_REF_PROP]
        : undefined;

    if (!maybeRef) {
      // TODO:
      throw Error("Cannot fix image without a file reference");
    }
    const filename = path.join(config.projectRoot, maybeRef);
    const buffer = fs.readFileSync(filename);
    let mimeType = filenameToMimeType(filename);
    if (!mimeType) {
      mimeType = "application/octet-stream";
    }
    const sha256 = Internal.getSHA256Hash(
      textEncoder.encode(
        // TODO: we should probably store the mimetype in the metadata and reuse it here
        `data:${mimeType};base64,${buffer.toString("base64")}`
      )
    );
    return {
      sha256,
      mimeType,
    };
  }
  const remainingErrors: ValidationError[] = [];
  const patch: Patch = [];
  for (const fix of validationError.fixes || []) {
    if (fix === "image:replace-metadata" || fix === "image:add-metadata") {
      const imageMetadata = await getImageMetadata();
      if (
        imageMetadata.width === undefined ||
        imageMetadata.height === undefined ||
        imageMetadata.sha256 === undefined
      ) {
        remainingErrors.push({
          ...validationError,
          message: "Failed to get image metadata",
          fixes: undefined,
        });
      } else if (fix === "image:replace-metadata") {
        const currentValue = validationError.value;
        const metadataIsCorrect =
          // metadata is a prop that is an object
          typeof currentValue === "object" &&
          currentValue &&
          "metadata" in currentValue &&
          currentValue.metadata &&
          typeof currentValue.metadata === "object" &&
          // sha256 is correct
          "sha256" in currentValue.metadata &&
          currentValue.metadata.sha256 === imageMetadata.sha256 &&
          // width is correct
          "width" in currentValue.metadata &&
          currentValue.metadata.width === imageMetadata.width &&
          // height is correct
          "height" in currentValue.metadata &&
          currentValue.metadata.height === imageMetadata.height &&
          // mimeType is correct
          "mimeType" in currentValue.metadata &&
          currentValue.metadata.mimeType === imageMetadata.mimeType;

        // skips if the metadata is already correct
        if (!metadataIsCorrect) {
          if (apply) {
            patch.push({
              op: "replace",
              path: sourceToPatchPath(sourcePath).concat("metadata"),
              value: {
                width: imageMetadata.width,
                height: imageMetadata.height,
                sha256: imageMetadata.sha256,
                mimeType: imageMetadata.mimeType,
              },
            });
          } else {
            if (
              typeof currentValue === "object" &&
              currentValue &&
              "metadata" in currentValue &&
              currentValue.metadata &&
              typeof currentValue.metadata === "object"
            ) {
              if (
                !("sha256" in currentValue.metadata) ||
                currentValue.metadata.sha256 !== imageMetadata.sha256
              ) {
                remainingErrors.push({
                  message:
                    "Image metadata sha256 is incorrect! Found: " +
                    ("sha256" in currentValue.metadata
                      ? currentValue.metadata.sha256
                      : "<empty>") +
                    ". Expected: " +
                    imageMetadata.sha256 +
                    ".",
                  fixes: undefined,
                });
              }
              if (
                !("width" in currentValue.metadata) ||
                currentValue.metadata.width !== imageMetadata.width
              ) {
                remainingErrors.push({
                  message:
                    "Image metadata width is incorrect! Found: " +
                    ("width" in currentValue.metadata
                      ? currentValue.metadata.width
                      : "<empty>") +
                    ". Expected: " +
                    imageMetadata.width,
                  fixes: undefined,
                });
              }
              if (
                !("height" in currentValue.metadata) ||
                currentValue.metadata.height !== imageMetadata.height
              ) {
                remainingErrors.push({
                  message:
                    "Image metadata height is incorrect! Found: " +
                    ("height" in currentValue.metadata
                      ? currentValue.metadata.height
                      : "<empty>") +
                    ". Expected: " +
                    imageMetadata.height,
                  fixes: undefined,
                });
              }
              if (
                !("mimeType" in currentValue.metadata) ||
                currentValue.metadata.mimeType !== imageMetadata.mimeType
              ) {
                remainingErrors.push({
                  message:
                    "Image metadata mimeType is incorrect! Found: " +
                    ("mimeType" in currentValue.metadata
                      ? currentValue.metadata.mimeType
                      : "<empty>") +
                    ". Expected: " +
                    imageMetadata.mimeType,
                  fixes: undefined,
                });
              }
            } else {
              remainingErrors.push({
                ...validationError,
                message: "Image metadata is not an object!",
                fixes: undefined,
              });
            }
          }
        }
      } else if (fix === "image:add-metadata") {
        patch.push({
          op: "add",
          path: sourceToPatchPath(sourcePath).concat("metadata"),
          value: {
            width: imageMetadata.width,
            height: imageMetadata.height,
            sha256: imageMetadata.sha256,
            mimeType: imageMetadata.mimeType,
          },
        });
      }
    } else if (fix === "file:add-metadata" || fix === "file:check-metadata") {
      const fileMetadata = await getFileMetadata();
      if (fileMetadata.sha256 === undefined) {
        remainingErrors.push({
          ...validationError,
          message: "Failed to get image metadata",
          fixes: undefined,
        });
      } else if (fix === "file:check-metadata") {
        const currentValue = validationError.value;
        const metadataIsCorrect =
          // metadata is a prop that is an object
          typeof currentValue === "object" &&
          currentValue &&
          "metadata" in currentValue &&
          currentValue.metadata &&
          typeof currentValue.metadata === "object" &&
          // sha256 is correct
          "sha256" in currentValue.metadata &&
          currentValue.metadata.sha256 === fileMetadata.sha256 &&
          // mimeType is correct
          "mimeType" in currentValue.metadata &&
          currentValue.metadata.mimeType === fileMetadata.mimeType;

        // skips if the metadata is already correct
        if (!metadataIsCorrect) {
          if (apply) {
            patch.push({
              op: "replace",
              path: sourceToPatchPath(sourcePath).concat("metadata"),
              value: {
                sha256: fileMetadata.sha256,
                ...(fileMetadata.mimeType
                  ? { mimeType: fileMetadata.mimeType }
                  : {}),
              },
            });
          } else {
            if (
              typeof currentValue === "object" &&
              currentValue &&
              "metadata" in currentValue &&
              currentValue.metadata &&
              typeof currentValue.metadata === "object"
            ) {
              if (
                !("sha256" in currentValue.metadata) ||
                currentValue.metadata.sha256 !== fileMetadata.sha256
              ) {
                remainingErrors.push({
                  message:
                    "File metadata sha256 is incorrect! Found: " +
                    ("sha256" in currentValue.metadata
                      ? currentValue.metadata.sha256
                      : "<empty>") +
                    ". Expected: " +
                    fileMetadata.sha256 +
                    ".",
                  fixes: undefined,
                });
              }
              if (
                !("mimeType" in currentValue.metadata) ||
                currentValue.metadata.mimeType !== fileMetadata.mimeType
              ) {
                remainingErrors.push({
                  message:
                    "File metadata mimeType is incorrect! Found: " +
                    ("mimeType" in currentValue.metadata
                      ? currentValue.metadata.mimeType
                      : "<empty>") +
                    ". Expected: " +
                    fileMetadata.mimeType,
                  fixes: undefined,
                });
              }
            } else {
              remainingErrors.push({
                ...validationError,
                message: "Image metadata is not an object!",
                fixes: undefined,
              });
            }
          }
        }
      } else if (fix === "file:add-metadata") {
        patch.push({
          op: "add",
          path: sourceToPatchPath(sourcePath).concat("metadata"),
          value: {
            sha256: fileMetadata.sha256,
            ...(fileMetadata.mimeType
              ? { mimeType: fileMetadata.mimeType }
              : {}),
          },
        });
      }
    }
  }
  if (!validationError.fixes || validationError.fixes.length === 0) {
    remainingErrors.push(validationError);
  }
  return {
    patch,
    remainingErrors,
  };
}
