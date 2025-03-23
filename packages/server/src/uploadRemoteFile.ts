import {
  Internal,
  SerializedFileSchema,
  SerializedImageSchema,
} from "@valbuild/core";
import { getFileExt } from "./getFileExt";

export async function uploadRemoteFile(
  fileBuffer: Buffer,
  publicProjectId: string,
  bucket: string,
  filePath: `public/val/${string}`,
  schema: SerializedImageSchema | SerializedFileSchema,
  metadata: Record<string, unknown> | undefined,
  auth:
    | {
        pat: string;
      }
    | {
        apiKey: string;
      },
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
  const fileHash = Internal.remote.getFileHash(fileBuffer);
  const coreVersion = Internal.VERSION.core || "unknown";
  const fileExt = getFileExt(filePath);
  const ref = Internal.remote.createRemoteRef({
    publicProjectId,
    coreVersion,
    bucket,
    validationHash: Internal.remote.getValidationBasis(
      coreVersion,
      schema,
      fileExt,
      metadata,
      fileHash,
    ),
    fileHash,
    filePath,
  });
  return uploadRemoteRef(fileBuffer, ref, auth);
}

export async function uploadRemoteRef(
  fileBuffer: Buffer,
  ref: string,
  auth:
    | {
        pat: string;
      }
    | {
        apiKey: string;
      },
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
  const authHeader:
    | {
        Authorization: string;
      }
    | {
        "x-val-pat": string;
      } =
    "apiKey" in auth
      ? {
          Authorization: `Bearer ${auth.apiKey}`,
        }
      : {
          "x-val-pat": auth.pat,
        };
  const res = await fetch(ref, {
    method: "PUT",
    headers: { ...authHeader, "Content-Type": "application/octet-stream" },
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
