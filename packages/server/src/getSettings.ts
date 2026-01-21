import { DEFAULT_CONTENT_HOST } from "@valbuild/core";
import { z } from "zod";

const host = process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST;

const SettingsSchema = z.object({
  publicProjectId: z.string(),
  remoteFileBuckets: z.array(z.object({ bucket: z.string() })),
});
type Settings = z.infer<typeof SettingsSchema>;

export async function getSettings(
  projectName: string,
  auth: { pat: string } | { apiKey: string },
): Promise<
  | {
      success: true;
      data: Settings;
    }
  | {
      success: false;
      message: string;
    }
> {
  try {
    const response = await fetch(`${host}/v1/${projectName}/settings`, {
      headers:
        "pat" in auth
          ? {
              "x-val-pat": auth.pat,
              "Content-Type": "application/json",
            }
          : {
              Authorization: `Bearer ${auth.apiKey}`,
              "Content-Type": "application/json",
            },
    });
    if (response.status === 404) {
      return {
        success: false,
        message: `Project '${projectName}' not found: verify that the name of the project is correct and that you have access to it.`,
      };
    }
    if (response.status !== 200) {
      return {
        success: false,
        message: `Failed to get project id: ${response.statusText}`,
      };
    }
    const json = await response.json();
    const parseRes = SettingsSchema.safeParse(json);
    if (!parseRes.success) {
      return {
        success: false,
        message: `Failed to parse settings data: ${parseRes.error.message}`,
      };
    }
    return {
      success: true,
      data: parseRes.data,
    };
  } catch {
    return {
      success: false,
      message: `Failed to get project id. Check network connection and try again.`,
    };
  }
}
