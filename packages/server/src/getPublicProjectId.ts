const host = process.env.VAL_CONTENT_URL || "https://content.val.build";

export async function getPublicProjectId(
  projectName: string,
  auth: { pat: string } | { apiKey: string },
): Promise<
  | {
      success: true;
      data: { publicProjectId: string };
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
        message: `Project ${projectName} not found. Verify that user has access to project and that it exists.`,
      };
    }
    if (response.status !== 200) {
      return {
        success: false,
        message: `Failed to get project id: ${response.statusText}`,
      };
    }
    const json = await response.json();
    if (typeof json?.publicProjectId !== "string") {
      return {
        success: false,
        message: `Invalid response: missing public project id`,
      };
    }
    return {
      success: true,
      data: { publicProjectId: json.publicProjectId },
    };
  } catch (err) {
    return {
      success: false,
      message: `Failed to get project id. Check network connection and try again.`,
    };
  }
}
