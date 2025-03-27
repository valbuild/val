import {
  FILE_REF_PROP,
  FILE_REF_SUBTYPE_TAG,
  FileMetadata,
  ImageMetadata,
  Internal,
  SerializedSchema,
  Source,
  SourcePath,
  VAL_EXTENSION,
  ValidationError,
} from "@valbuild/core";
import { JSONValue, Patch, sourceToPatchPath } from "@valbuild/core/patch";
import fs from "fs";
import { extractFileMetadata, extractImageMetadata } from "./extractMetadata";
import { getValidationErrorFileRef } from "./getValidationErrorFileRef";
import path from "path";
import { checkRemoteRef, downloadFileFromRemote } from "./checkRemoteRef";

// TODO: find a better name? transformFixesToPatch?
export async function createFixPatch(
  config: { projectRoot: string; remoteHost: string },
  apply: boolean,
  sourcePath: SourcePath,
  validationError: ValidationError,
  remoteFiles: {
    [sourcePath: SourcePath]: {
      ref: string;
      metadata?: Record<string, unknown>;
    };
  },
  moduleSource?: Source,
  moduleSchema?: SerializedSchema,
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
        if (!imageMetadata.mimeType) {
          remainingErrors.push({
            ...validationError,
            message: "Failed to get image metadata",
            fixes: undefined,
          });
        } else {
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
    } else if (fix === "image:upload-remote" || fix === "file:upload-remote") {
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
    } else if (
      fix === "image:download-remote" ||
      fix === "file:download-remote"
    ) {
      const v = getRemoteValueFromValidationError(validationError);
      if (!v.success) {
        remainingErrors.push({
          ...validationError,
          message: v.message,
          fixes: undefined,
        });
        continue;
      }
      const splitRemoteRefDataRes = Internal.remote.splitRemoteRef(v._ref);
      if (splitRemoteRefDataRes.status === "error") {
        remainingErrors.push({
          ...validationError,
          message: splitRemoteRefDataRes.error,
          fixes: undefined,
        });
        continue;
      }
      const url = v._ref;
      const filePath = splitRemoteRefDataRes.filePath;
      if (!filePath) {
        remainingErrors.push({
          ...validationError,
          message: "Unexpected error while downloading remote (no filePath)",
          fixes: undefined,
        });
        continue;
      }
      if (!filePath.startsWith("public/val/")) {
        remainingErrors.push({
          ...validationError,
          message:
            "Unexpected error while downloading remote (invalid file path - must start with public/val/)",
          fixes: undefined,
        });
        continue;
      }
      const absoluteFilePath = path.join(
        config.projectRoot,
        splitRemoteRefDataRes.filePath,
      );
      await fs.promises.mkdir(path.dirname(absoluteFilePath), {
        recursive: true,
      });
      const res = await downloadFileFromRemote(url, absoluteFilePath);
      if (res.status === "error") {
        remainingErrors.push({
          ...validationError,
          message: res.error,
          fixes: undefined,
        });
        continue;
      }
      const value = {
        [VAL_EXTENSION]: "file",
        [FILE_REF_PROP]: `/${filePath}`,
        ...(fix === "image:download-remote"
          ? {
              [FILE_REF_SUBTYPE_TAG]: "image",
            }
          : {}),
      };
      patch.push({
        op: "replace",
        path: sourceToPatchPath(sourcePath),
        value: v.metadata
          ? {
              ...value,
              metadata: v.metadata as JSONValue,
            }
          : value,
      });
    } else if (fix === "file:check-remote" || fix === "image:check-remote") {
      const v = getRemoteValueFromValidationError(validationError);
      if (!v.success) {
        remainingErrors.push({
          ...validationError,
          message: v.message,
          fixes: undefined,
        });
        continue;
      }

      const [, modulePath] =
        Internal.splitModuleFilePathAndModulePath(sourcePath);
      if (moduleSource === undefined) {
        remainingErrors.push({
          ...validationError,
          message: "Unexpected error while checking remote (no moduleSource)",
          fixes: undefined,
        });
        continue;
      }
      if (moduleSchema === undefined) {
        remainingErrors.push({
          ...validationError,
          message: "Unexpected error while checking remote (no moduleSchema)",
          fixes: undefined,
        });
        continue;
      }
      const { schema: schemaAtPath } = Internal.resolvePath(
        modulePath,
        moduleSource,
        moduleSchema,
      );

      if (schemaAtPath.type === "image" || schemaAtPath.type === "file") {
        const res = await checkRemoteRef(
          config.remoteHost,
          v._ref,
          config.projectRoot,
          schemaAtPath,
          v.metadata,
        );
        if (res.status === "success") {
          // do nothing
        } else if (res.status === "error") {
          remainingErrors.push({
            ...validationError,
            message: res.error,
            fixes: undefined,
          });
        } else if (res.status === "fix-required") {
          if (apply) {
            patch.push({
              op: "replace",
              path: sourceToPatchPath(sourcePath),
              value: {
                _type: "remote",
                _ref: res.ref,
                metadata: res.metadata,
              },
            });
          } else {
            remainingErrors.push({
              ...validationError,
              message: `Remote ref: ${res.ref} is not valid. Use the --fix flag to fix this issue.`,
              fixes: undefined,
            });
          }
        } else {
          const exhaustiveCheck: never = res;
          remainingErrors.push({
            ...validationError,
            message: `Internal error found found unexpected status: ${JSON.stringify(
              exhaustiveCheck,
            )}`,
            fixes: undefined,
          });
        }
      } else {
        remainingErrors.push({
          ...validationError,
          message:
            "Could not check remote ref: schema type is not image or file: " +
            schemaAtPath?.type,
          fixes: undefined,
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

function getRemoteValueFromValidationError(v: ValidationError):
  | {
      success: false;
      message: string;
    }
  | {
      success: true;
      _ref: string;
      metadata?: Record<string, unknown>;
    } {
  if (v.value && typeof v.value !== "object") {
    return {
      success: false,
      message: "Unexpected error while checking remote (not an object)",
    };
  }
  if (!v.value) {
    return {
      success: false,
      message: "Unexpected error while checking remote (no value)",
    };
  }
  if (
    typeof v.value !== "object" ||
    v.value === null ||
    !(FILE_REF_PROP in v.value)
  ) {
    return {
      success: false,
      message: "Unexpected error while checking remote (no _ref in value)",
    };
  }
  if (typeof v.value._ref !== "string") {
    return {
      success: false,
      message: "Unexpected error while checking remote (_ref is not a string)",
    };
  }
  let metadata: Record<string, unknown> | undefined;
  if ("metadata" in v.value && typeof v.value.metadata === "object") {
    if (v.value.metadata === null) {
      return {
        success: false,
        message: "Unexpected error while checking remote (metadata is null)",
      };
    }
    if (Array.isArray(v.value.metadata)) {
      return {
        success: false,
        message:
          "Unexpected error while checking remote (metadata is an array)",
      };
    }
    metadata = v.value.metadata as Record<string, unknown> | undefined;
  }
  return {
    success: true,
    _ref: v.value._ref,
    metadata,
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
