import {
  FileMetadata,
  ImageMetadata,
  Internal,
  SerializedSchema,
  Source,
  SourcePath,
  ValidationError,
} from "@valbuild/core";
import {
  isNotRoot,
  JSONValue,
  Patch,
  sourceToPatchPath,
} from "@valbuild/core/patch";
import fs from "fs";
import { extractFileMetadata, extractImageMetadata } from "./extractMetadata";
import { getValidationErrorFileRef } from "./getValidationErrorFileRef";
import path from "path";
import { checkRemoteRef, downloadFileFromRemote } from "./checkRemoteRef";

// A remaining error may optionally carry a more specific `sourcePath` than the
// one the fix was created from. This is used by gallery checks, where a single
// record-level fix expands into per-entry errors that should point at the
// individual entry (e.g. `?p="/public/val/logo.png"`) rather than the record.
export type FixPatchRemainingError = ValidationError & {
  sourcePath?: SourcePath;
};

// Gallery entries are keyed by their file path. Remote galleries key uploaded
// entries by a remote URL while keeping the file on disk at its local path, so
// normalize a remote-URL key back to that local path for on-disk reads.
function galleryKeyToLocalPath(key: string): string {
  const res = Internal.remote.splitRemoteRef(key);
  return res.status === "success" ? `/${res.filePath}` : key;
}

// Patch path of the record that holds a media entry. Media keys are file paths
// that can contain dots, which sourceToPatchPath cannot round-trip, so strip
// the (JSON-encoded) key segment off the entry source path and convert the
// remaining parent path — whose ancestors are plain object keys / array
// indices — instead.
function parentPatchPathOfMediaEntry(sourcePath: SourcePath, entryKey: string) {
  const jsonKey = JSON.stringify(entryKey);
  let parent: string = sourcePath;
  if (parent.endsWith(jsonKey)) {
    parent = parent.slice(0, parent.length - jsonKey.length);
  }
  if (parent.endsWith(".")) {
    parent = parent.slice(0, -1);
  } else if (parent.endsWith(Internal.ModuleFilePathSep)) {
    parent = parent.slice(0, parent.length - Internal.ModuleFilePathSep.length);
  }
  return sourceToPatchPath(parent as SourcePath);
}

// TODO: find a better name? transformFixesToPatch?
/**
 * The media value a validation error flagged, read as a plain record.
 *
 * A `ValidationError` carries only a value, never the schema that rejected it,
 * so the shape is all there is to go on here.
 */
function mediaValueOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

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
): Promise<
  { patch: Patch; remainingErrors: FixPatchRemainingError[] } | undefined
> {
  const remainingErrors: FixPatchRemainingError[] = [];
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
        const currentValue = mediaValueOf(validationError.value);
        const derived = {
          width: imageMetadata.width,
          height: imageMetadata.height,
          mimeType: imageMetadata.mimeType,
        };
        // One op per field, not one for the whole object: `alt` and `hotspot`
        // are authored and sit next to these, so a whole-object write would
        // throw away what a person typed.
        const wrong = (
          Object.entries(derived) as [keyof typeof derived, unknown][]
        ).filter(([field, expected]) => currentValue?.[field] !== expected);
        if (wrong.length > 0) {
          if (apply) {
            for (const [field, expected] of wrong) {
              patch.push({
                op: "add",
                path: sourceToPatchPath(sourcePath).concat(field),
                value: expected as JSONValue,
              });
            }
          } else if (currentValue) {
            for (const [field, expected] of wrong) {
              remainingErrors.push({
                message:
                  `Image ${field} is incorrect! Found: ` +
                  (currentValue[field] ?? "<empty>") +
                  ". Expected: " +
                  expected,
                fixes: undefined,
              });
            }
          } else {
            remainingErrors.push({
              ...validationError,
              message: "Image is not an object!",
              fixes: undefined,
            });
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
          const patchPath = sourceToPatchPath(sourcePath);
          patch.push(
            {
              op: "add",
              path: patchPath.concat("width"),
              value: imageMetadata.width,
            },
            {
              op: "add",
              path: patchPath.concat("height"),
              value: imageMetadata.height,
            },
            {
              op: "add",
              path: patchPath.concat("mimeType"),
              value: imageMetadata.mimeType,
            },
          );
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
        const currentValue = mediaValueOf(validationError.value);
        if (currentValue?.mimeType !== fileMetadata.mimeType) {
          if (apply) {
            patch.push({
              op: "add",
              path: sourceToPatchPath(sourcePath).concat("mimeType"),
              value: fileMetadata.mimeType ?? null,
            });
          } else if (currentValue) {
            remainingErrors.push({
              message:
                "File mimeType is incorrect! Found: " +
                (currentValue.mimeType ?? "<empty>") +
                ". Expected: " +
                fileMetadata.mimeType,
              fixes: undefined,
            });
          } else {
            remainingErrors.push({
              ...validationError,
              message: "File is not an object!",
              fixes: undefined,
            });
          }
        }
      } else if (fix === "file:add-metadata") {
        patch.push({
          op: "add",
          path: sourceToPatchPath(sourcePath).concat("mimeType"),
          value: fileMetadata.mimeType ?? null,
        });
      }
    } else if (fix === "image:upload-remote" || fix === "file:upload-remote") {
      const remoteFile = remoteFiles[sourcePath];
      let metadata = remoteFile.metadata as JSONValue | undefined;
      if (!metadata) {
        if (fix === "image:upload-remote") {
          metadata = await getImageMetadata(
            config.projectRoot,
            validationError,
          );
        } else if (fix === "file:upload-remote") {
          metadata = await getFileMetadata(config.projectRoot, validationError);
        }
      }
      if (!metadata) {
        remainingErrors.push({
          ...validationError,
          message: "Failed to get metadata for remote file",
          fixes: undefined,
        });
      } else if (!remoteFile) {
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
            path: remoteFile.ref,
            ...(metadata as Record<string, JSONValue>),
          },
          path: sourceToPatchPath(sourcePath),
        });
      }
    } else if (
      fix === "images:upload-remote" ||
      fix === "files:upload-remote"
    ) {
      // Gallery entry: the record is keyed by the file path, so uploading to
      // remote means renaming the key from the local path to the remote URL
      // (remove the old key, add the new one with the same metadata).
      const remoteFile = remoteFiles[sourcePath];
      if (!remoteFile) {
        remainingErrors.push({
          ...validationError,
          message:
            "Cannot fix local to remote gallery entry: remote file was not uploaded",
          fixes: undefined,
        });
        continue;
      }
      const metadata = remoteFile.metadata as JSONValue | undefined;
      if (!metadata) {
        remainingErrors.push({
          ...validationError,
          message: "Failed to get metadata for remote gallery file",
          fixes: undefined,
        });
        continue;
      }
      // The entry is keyed by its (local) file path, which can contain dots
      // (e.g. image.png). sourceToPatchPath can't round-trip such keys, so
      // build the patch path from the parent record path plus the key (which
      // validateMediaKey carries as the error value), like the UI does.
      const entryKey = validationError.value;
      if (typeof entryKey !== "string") {
        remainingErrors.push({
          ...validationError,
          message: "Cannot rewrite remote gallery entry: missing entry key",
          fixes: undefined,
        });
        continue;
      }
      const parentPath = parentPatchPathOfMediaEntry(sourcePath, entryKey);
      const removePath = parentPath.concat(entryKey);
      const addPath = parentPath.concat(remoteFile.ref);
      if (!isNotRoot(removePath) || !isNotRoot(addPath)) {
        remainingErrors.push({
          ...validationError,
          message: "Cannot rewrite remote gallery entry at root path",
          fixes: undefined,
        });
        continue;
      }
      patch.push({ op: "remove", path: removePath });
      patch.push({ op: "add", path: addPath, value: metadata });
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
      if (!filePath.startsWith("public/")) {
        remainingErrors.push({
          ...validationError,
          message:
            "Unexpected error while downloading remote (invalid file path - must start with public/)",
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
      patch.push({
        op: "replace",
        path: sourceToPatchPath(sourcePath),
        value: {
          path: `/${filePath}`,
          ...((v.metadata ?? {}) as Record<string, JSONValue>),
        },
      });
    } else if (
      fix === "images:check-all-files" ||
      fix === "files:check-all-files"
    ) {
      if (!moduleSource || typeof moduleSource !== "object") {
        remainingErrors.push({
          ...validationError,
          message:
            "Unexpected error while checking gallery metadata (no moduleSource)",
          fixes: undefined,
        });
        continue;
      }
      const gallerySource = moduleSource as Record<string, unknown>;
      for (const [entryKey, storedEntry] of Object.entries(gallerySource)) {
        const filename = path.join(
          config.projectRoot,
          galleryKeyToLocalPath(entryKey),
        );
        let buffer: Buffer;
        try {
          buffer = fs.readFileSync(filename);
        } catch {
          if (apply) {
            const removePath = sourceToPatchPath(sourcePath).concat([entryKey]);
            if (isNotRoot(removePath)) {
              patch.push({ op: "remove", path: removePath });
            }
          } else {
            remainingErrors.push({
              ...validationError,
              message: `Could not read file: ${filename} - file might not exist or can not be accessed`,
              fixes: undefined,
            });
          }
          continue;
        }
        if (fix === "images:check-all-files") {
          const actualMetadata = await extractImageMetadata(filename, buffer);
          const stored = storedEntry as Record<string, unknown>;
          const metadataIsCorrect =
            stored.width === actualMetadata.width &&
            stored.height === actualMetadata.height &&
            stored.mimeType === actualMetadata.mimeType;
          if (!metadataIsCorrect) {
            if (apply) {
              patch.push({
                op: "replace",
                path: sourceToPatchPath(sourcePath).concat([entryKey]),
                value: {
                  ...stored,
                  width: actualMetadata.width ?? 0,
                  height: actualMetadata.height ?? 0,
                  mimeType:
                    actualMetadata.mimeType ?? "application/octet-stream",
                },
              });
            } else {
              remainingErrors.push({
                ...validationError,
                message: `Image metadata for '${entryKey}' is incorrect (width: ${stored.width ?? "<empty>"} vs ${actualMetadata.width}, height: ${stored.height ?? "<empty>"} vs ${actualMetadata.height}, mimeType: ${stored.mimeType ?? "<empty>"} vs ${actualMetadata.mimeType}). Use --fix to update.`,
                sourcePath: Internal.createValPathOfItem(sourcePath, entryKey),
                // Gallery entries are keyed by their file path; surface the
                // error on the key rather than the derived metadata value.
                keyError: true,
              });
            }
          }
        } else if (fix === "files:check-all-files") {
          const actualMetadata = await extractFileMetadata(filename, buffer);
          const stored = storedEntry as Record<string, unknown>;
          const metadataIsCorrect = stored.mimeType === actualMetadata.mimeType;
          if (!metadataIsCorrect) {
            if (apply) {
              patch.push({
                op: "replace",
                path: sourceToPatchPath(sourcePath).concat([entryKey]),
                value: {
                  ...stored,
                  mimeType:
                    actualMetadata.mimeType ?? "application/octet-stream",
                },
              });
            } else {
              remainingErrors.push({
                ...validationError,
                message: `File metadata for '${entryKey}' has incorrect mimeType: '${stored.mimeType ?? "<empty>"}' vs '${actualMetadata.mimeType}'. Use --fix to update.`,
                sourcePath: Internal.createValPathOfItem(sourcePath, entryKey),
                // Gallery entries are keyed by their file path; surface the
                // error on the key rather than the derived metadata value.
                keyError: true,
              });
            }
          }
        } else {
          const exhaustiveCheck: never = fix;
          throw new Error(
            `Internal error: unhandled fix type ${exhaustiveCheck}`,
          );
        }
      }
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
  if (typeof v.value !== "object" || v.value === null || !("path" in v.value)) {
    return {
      success: false,
      message: "Unexpected error while checking remote (no path in value)",
    };
  }
  if (typeof v.value.path !== "string") {
    return {
      success: false,
      message: "Unexpected error while checking remote (path is not a string)",
    };
  }
  // Everything but the path is what Val read from the bytes.
  const { path: ref, ...metadata } = v.value as Record<string, unknown> & {
    path: string;
  };
  return {
    success: true,
    _ref: ref,
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
