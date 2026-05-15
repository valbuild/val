import { useState, useCallback } from "react";
import {
  ImageMetadata,
  ModuleFilePath,
  SerializedImageSchema,
  SerializedFileSchema,
  SerializedSchema,
} from "@valbuild/core";
import { Patch } from "@valbuild/core/patch";
import { JSONValue } from "@valbuild/core/patch";
import { readImageFromFile } from "../../utils/readImage";
import { createFilePatch } from "./FileField";

export interface ImageUploadConfig {
  patchPath: string[];
  addAndUploadPatchWithFileOps: (
    patch: Patch,
    type: "image" | "file",
    onError: (message: string) => void,
    onProgress: (
      bytesUploaded: number,
      totalBytes: number,
      currentFile: number,
      totalFiles: number,
    ) => void,
  ) => Promise<void>;
  addModuleFilePatch: (
    moduleFilePath: ModuleFilePath,
    patch: Patch,
    type: SerializedSchema["type"],
  ) => void;
  remoteData: {
    publicProjectId: string;
    coreVersion: string;
    bucket: string;
    schema: SerializedImageSchema | SerializedFileSchema;
    remoteHost: string;
  } | null;
  directory: string | undefined;
  referencedModule: string | undefined;
  existingAlt?: string;
  /**
   * When true, only the file upload op is sent (the replace op that sets the
   * field value is stripped). Used for richtext where the image node is inserted
   * into the ProseMirror document separately and the field value is synced via
   * the normal richtext patch flow.
   */
  fileUploadOnly?: boolean;
}

export interface ImageUploadResult {
  filePath: string;
  ref: string;
}

export interface UseImageUploadReturn {
  uploadImage: (file: File) => Promise<ImageUploadResult | null>;
  loading: boolean;
  error: string | null;
  progressPercentage: number | null;
}

export function useImageUpload(
  config: ImageUploadConfig,
): UseImageUploadReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressPercentage, setProgressPercentage] = useState<number | null>(
    null,
  );

  const uploadImage = useCallback(
    async (file: File): Promise<ImageUploadResult | null> => {
      setError(null);
      setLoading(true);
      setProgressPercentage(0);

      try {
        const res = await readImageFromFile(file);

        let metadata: ImageMetadata | undefined;
        if (res.width && res.height && res.mimeType) {
          metadata = {
            width: res.width,
            height: res.height,
            mimeType: res.mimeType,
            alt: config.existingAlt,
          };
        }

        const { patch, filePath } = await createFilePatch(
          config.patchPath,
          res.src,
          res.filename ?? null,
          res.fileHash,
          metadata,
          "image",
          config.remoteData,
          config.directory,
          !!config.referencedModule,
        );

        if (patch.length === 0) {
          setLoading(false);
          setProgressPercentage(null);
          setError("Could not process image file");
          return null;
        }

        const refFromPatch =
          patch[0] &&
          "value" in patch[0] &&
          typeof patch[0].value === "object" &&
          patch[0].value !== null &&
          "_ref" in patch[0].value
            ? (patch[0].value._ref as string)
            : filePath;

        const uploadPatch = config.fileUploadOnly
          ? patch.filter((op) => op.op === "file")
          : patch;

        return await new Promise<ImageUploadResult | null>((resolve) => {
          let hasError = false;
          config
            .addAndUploadPatchWithFileOps(
              uploadPatch,
              "image",
              (errorMessage) => {
                hasError = true;
                setError(errorMessage);
                setLoading(false);
                setProgressPercentage(null);
                resolve(null);
              },
              (bytesUploaded, totalBytes, currentFile, totalFiles) => {
                const overallProgress =
                  (currentFile * totalBytes + bytesUploaded) /
                  (totalFiles * totalBytes);
                setProgressPercentage(Math.round(overallProgress * 100));
              },
            )
            .then(() => {
              if (!hasError) {
                if (
                  config.referencedModule &&
                  filePath &&
                  metadata?.mimeType &&
                  metadata.width !== undefined &&
                  metadata.height !== undefined
                ) {
                  config.addModuleFilePatch(
                    config.referencedModule as ModuleFilePath,
                    [
                      {
                        op: "add",
                        path: [filePath],
                        value: {
                          width: metadata.width,
                          height: metadata.height,
                          mimeType: metadata.mimeType,
                          alt:
                            typeof metadata.alt === "string"
                              ? metadata.alt
                              : null,
                        } as JSONValue,
                      },
                    ],
                    "record",
                  );
                }
                resolve({ filePath, ref: refFromPatch });
              }
            })
            .finally(() => {
              setProgressPercentage(null);
              setLoading(false);
            });
        });
      } catch (err) {
        console.error("Failed to upload image", err);
        setLoading(false);
        setProgressPercentage(null);
        setError("Could not upload file. Please try again later");
        return null;
      }
    },
    [config],
  );

  return { uploadImage, loading, error, progressPercentage };
}
