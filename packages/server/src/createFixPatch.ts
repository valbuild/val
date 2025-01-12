import {
  FileMetadata,
  ImageMetadata,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { JSONValue, Patch, sourceToPatchPath } from "@valbuild/core/patch";
import fs from "fs";
import { extractFileMetadata, extractImageMetadata } from "./extractMetadata";
import { getValidationErrorFileRef } from "./getValidationErrorFileRef";
import path from "path";

// TODO: find a better name? transformFixesToPatch?
export async function createFixPatch(
  config: { projectRoot: string },
  apply: boolean,
  sourcePath: SourcePath,
  validationError: ValidationError,
  remoteFiles: {
    [sourcePath: SourcePath]: {
      ref: string;
      metadata?: Record<string, unknown>;
    };
  },
): Promise<{ patch: Patch; remainingErrors: ValidationError[] } | undefined> {
  const remainingErrors: ValidationError[] = [];
  const patch: Patch = [];
  for (const fix of validationError.fixes || []) {
    if (fix === "image:check-metadata" || fix === "image:add-metadata") {
      const imageMetadata = await getImageMetadata(
        config.projectRoot,
        validationError,
      );
      if (
        imageMetadata.width === undefined ||
        imageMetadata.height === undefined
      ) {
        remainingErrors.push({
          ...validationError,
          message: "Failed to get image metadata",
          fixes: undefined,
        });
      } else if (fix === "image:check-metadata") {
        const currentValue = validationError.value;
        const metadataIsCorrect =
          // metadata is a prop that is an object
          typeof currentValue === "object" &&
          currentValue &&
          "metadata" in currentValue &&
          currentValue.metadata &&
          typeof currentValue.metadata === "object" &&
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(currentValue as any).metadata,
                width: imageMetadata.width,
                height: imageMetadata.height,
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
            mimeType: imageMetadata.mimeType,
          },
        });
      }
    } else if (fix === "file:add-metadata" || fix === "file:check-metadata") {
      const fileMetadata = await getFileMetadata(
        config.projectRoot,
        validationError,
      );
      if (fileMetadata === undefined) {
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
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(currentValue as any).metadata,
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
            ...(fileMetadata.mimeType
              ? { mimeType: fileMetadata.mimeType }
              : {}),
          },
        });
      }
    } else if (fix === "image:upload-remote") {
      const remoteFile = remoteFiles[sourcePath];
      if (!remoteFile) {
        remainingErrors.push({
          ...validationError,
          message:
            "Cannot fix local to remote image: remote image was not uploaded",
          fixes: undefined,
        });
      } else {
        patch.push({
          op: "replace",
          value: {
            _type: "remote",
            _ref: remoteFile.ref,
            metadata: remoteFile.metadata as JSONValue,
          },
          path: sourceToPatchPath(sourcePath),
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

export async function getImageMetadata(
  projectRoot: string,
  validationError: ValidationError,
): Promise<ImageMetadata> {
  const fileRef = getValidationErrorFileRef(validationError);
  if (!fileRef) {
    // TODO:
    throw Error("Cannot fix image without a file reference");
  }
  const filename = path.join(projectRoot, fileRef);
  const buffer = fs.readFileSync(filename);
  return extractImageMetadata(filename, buffer);
}

export async function getFileMetadata(
  projectRoot: string,
  validationError: ValidationError,
): Promise<FileMetadata> {
  const fileRef = getValidationErrorFileRef(validationError);
  if (!fileRef) {
    // TODO:
    throw Error("Cannot fix file without a file reference");
  }
  const filename = path.join(projectRoot, fileRef);
  const buffer = fs.readFileSync(filename);
  return extractFileMetadata(fileRef, buffer);
}
