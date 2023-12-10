import {
  FILE_REF_PROP,
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
  imageTypeToMimeType,
  mimeTypeToFileExt,
} from "@valbuild/shared/internal";

// TODO: find a better name? transformFixesToPatch?
const textEncoder = new TextEncoder();
export async function createFixPatch(
  config: { projectRoot: string },
  apply: boolean,
  sourcePath: SourcePath,
  validationError: ValidationError
): Promise<{ patch: Patch; remainingErrors: ValidationError[] } | undefined> {
  async function getImageMetadata() {
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

    const sha256 = Internal.getSHA256Hash(
      textEncoder.encode(
        // TODO: we should probably store the mimetype in the metadata and reuse it here
        `data:${
          imageSize.type
            ? imageTypeToMimeType(imageSize.type)
            : filenameToMimeType(filename)
        };base64,${buffer.toString("base64")}`
      )
    );
    return {
      ...imageSize,
      sha256,
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
          currentValue.metadata.height === imageMetadata.height;

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
