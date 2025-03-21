import { VAL_REMOTE_HOST } from "@valbuild/core";
import { z } from "zod";

const RemoteFileBuckets = z.array(z.object({ bucket: z.string() }));
export async function getRemoteFileBuckets(
  publicProjectId: string,
  auth: { pat: string } | { apiKey: string },
): Promise<
  | { success: true; data: { bucket: string }[] }
  | { success: false; message: string }
> {
  try {
    const res = await fetch(
      `${VAL_REMOTE_HOST}/file/p/${publicProjectId}/buckets`,
      {
        headers:
          "pat" in auth
            ? { "x-val-pat": auth.pat, "Content-Type": "application/json" }
            : {
                Authorization: `Bearer ${auth.apiKey}`,
                "Content-Type": "application/json",
              },
      },
    );
    if (!res.ok) {
      return {
        success: false,
        message: `Failed to get remote file buckets: ${res.statusText}`,
      };
    }
    if (res.headers.get("content-type")?.includes("application/json")) {
      const parseRes = RemoteFileBuckets.safeParse(await res.json());
      if (parseRes.success) {
        return {
          success: true,
          data: parseRes.data,
        };
      }
      return {
        success: false,
        message:
          "Could not parse data from remote server. Verify that versions Val.",
      };
    }
    return {
      success: false,
      message:
        "Failed to get remote file buckets: invalid response (not json).",
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to get remote file buckets: ${err}. Check your internet connection and try again.`,
    };
  }
}
