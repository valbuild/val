import {
  FileMetadata,
  ImageMetadata,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import { Patch, sourceToPatchPath } from "@valbuild/core/patch";
import fs from "fs";
import { extractFileMetadata, extractImageMetadata } from "./extractMetadata";
import { getValidationErrorFileRef } from "./getValidationErrorFileRef";
import path from "path";

// TODO: find a better name? transformFixesToPatch?
export async function createFixPatch(
  config: { projectRoot: string },
  apply: boolean,
  sourcePath: SourcePath,
  validationError: ValidationError
): Promise<{ patch: Patch; remainingErrors: ValidationError[] } | undefined> {
  async function getImageMetadata(): Promise<ImageMetadata> {
    const fileRef = getValidationErrorFileRef(validationError);
    if (!fileRef) {
      // TODO:
      throw Error("Cannot fix image without a file reference");
    }
    const filename = path.join(config.projectRoot, fileRef);
    const buffer = fs.readFileSync(filename);
    return extractImageMetadata(filename, buffer);
  }
  async function getFileMetadata(): Promise<FileMetadata> {
    const fileRef = getValidationErrorFileRef(validationError);
    if (!fileRef) {
      // TODO:
      throw Error("Cannot fix file without a file reference");
    }
    const filename = path.join(config.projectRoot, fileRef);
    const buffer = fs.readFileSync(filename);
    return extractFileMetadata(fileRef, buffer);
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
