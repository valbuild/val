import {
  Internal,
  SerializedFileSchema,
  SerializedImageSchema,
  VAL_REMOTE_HOST,
} from "@valbuild/core";
import { promises as fs } from "fs";
import path from "path";
import { getFileExt } from "./getFileExt";

export async function getRemoteFileBuckets(
  publicProjectId: string,
  pat: string,
) {
  const res = await fetch(
    `${VAL_REMOTE_HOST}/file/p/${publicProjectId}/buckets`,
    {
      headers: {
        "x-val-pat": pat,
      },
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to get remote file buckets: ${res.statusText}`);
  }
  const json = (await res.json()) as { bucket: string }[];
  return json.map((b) => b.bucket);
}

const textEncoder = new TextEncoder();
export async function uploadRemoteFile(
  publicProjectId: string,
  bucket: string,
  root: string,
  filePath: string,
  schema: SerializedImageSchema | SerializedFileSchema,
  metadata: Record<string, unknown> | undefined,
  pat: string,
): Promise<
  | {
      success: true;
      ref: string;
    }
  | {
      success: false;
      error: string;
    }
> {
  const fileBuffer = await fs.readFile(filePath);
  const relativeFilePath = path
    .relative(root, filePath)
    .split(path.sep)
    .join("/") as `public/val/${string}`;
  if (!relativeFilePath.startsWith("public/val/")) {
    return {
      success: false,
      error: `File path must be within the public/val/ directory (e.g. public/val/path/to/file.txt). Got: ${relativeFilePath}`,
    };
  }
  const fileHash = Internal.remote.getFileHash(fileBuffer);
  const coreVersion = Internal.VERSION.core || "unknown";
  const ref = Internal.remote.createRemoteRef({
    publicProjectId,
    coreVersion,
    bucket,
    validationHash: Internal.remote.getValidationHash(
      coreVersion,
      schema,
      getFileExt(relativeFilePath),
      metadata,
      fileHash,
      textEncoder,
    ),
    fileHash,
    filePath: relativeFilePath,
  });
  const res = await fetch(ref, {
    method: "PUT",
    headers:
      typeof metadata?.mimeType === "string"
        ? {
            "x-val-pat": pat,
            "content-type": metadata.mimeType,
          }
        : {
            "x-val-pat": pat,
          },
    body: fileBuffer,
  });
  if (!res.ok) {
    if (res.status === 409) {
      // File already exists
      return {
        success: true,
        ref,
      };
    }
    if (res.headers.get("content-type")?.includes("application/json")) {
      const json = await res.json();
      if (json.message) {
        return {
          success: false,
          error: `${ref}. Failed to upload file: ${json.message}.`,
        };
      } else {
        return {
          success: false,
          error: `${ref}. Failed to upload file: ${JSON.stringify(json)}.`,
        };
      }
    }
    return {
      success: false,
      error: `${ref}. Failed to upload file: ${await res.text()}.`,
    };
  }
  return {
    success: true,
    ref,
  };
}
