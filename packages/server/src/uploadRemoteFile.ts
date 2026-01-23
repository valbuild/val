import { getErrorMessageFromUnknownJson } from "@valbuild/shared/internal";

export async function uploadRemoteFile(
  contentHost: string,
  project: string,
  bucket: string,
  fileHash: string,
  fileExt: string,
  fileBuffer: Buffer,
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
  const res = await fetch(
    `${contentHost}/v1/${project}/remote/files/b/${bucket}/f/${fileHash}.${fileExt}`,
    {
      method: "PUT",
      headers: { ...authHeader, "Content-Type": "application/octet-stream" },
      body: new Uint8Array(fileBuffer),
    },
  );
  if (!res.ok) {
    if (res.status === 409) {
      // File already exists
      return {
        success: true,
      };
    }
    if (res.headers.get("content-type")?.includes("application/json")) {
      const json = await res.json();
      const message = getErrorMessageFromUnknownJson(
        json,
        JSON.stringify(json),
      );
      return {
        success: false,
        error: `Failed to upload remote file: ${message}.`,
      };
    }
    return {
      success: false,
      error: `An unexpected error occurred while uploading remote file. HTTP status was: ${await res.text()}.`,
    };
  }
  return {
    success: true,
  };
}
