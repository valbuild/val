import { FILE_REF_PROP, SourcePath, ValidationError } from "@valbuild/core";
import { Patch, sourceToPatchPath } from "@valbuild/core/patch";
import sizeOf from "image-size";
import path from "path";
import fs from "fs";
import crypto from "crypto";

export async function createFixPatch(
  config: { projectRoot: string },
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
    const localFile = path.join(config.projectRoot, maybeRef);
    const buffer = fs.readFileSync(localFile);
    const sha256 = await getSHA256Hash(buffer);
    const imageSize = sizeOf(buffer);
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
          patch.push({
            op: "replace",
            path: sourceToPatchPath(sourcePath).concat("metadata"),
            value: {
              width: imageMetadata.width,
              height: imageMetadata.height,
              sha256: imageMetadata.sha256,
            },
          });
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

const getSHA256Hash = async (bits: Uint8Array) => {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bits);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
  return hash;
};
