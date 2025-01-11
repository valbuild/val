const host = process.env.VAL_CONTENT_URL || "https://content.val.build";

export async function getPublicProjectId(
  projectName: string,
  pat: string,
): Promise<
  | {
      success: true;
      data: { publicProjectId: string };
    }
  | {
      success: false;
      error: string;
    }
> {
  try {
    // const response = await fetch(`${host}/project/${projectName}`, {
    //   headers: {
    //     "X-VAL-AUTH-PAT": `Bearer ${pat}`,
    //   },
    // });
    // if (response.status === 404) {
    //   return {
    //     success: false,
    //     error: `Project ${projectName} not found. Verify that user has access to project and that it exists.`,
    //   };
    // }
    // if (response.status !== 200) {
    //   return {
    //     success: false,
    //     error: `Failed to get project id: ${response.statusText}`,
    //   };
    // }
    // const json = await response.json();
    // if (typeof json?.publicProjectId !== "string") {
    //   return {
    //     success: false,
    //     error: `Invalid response: missing public project id`,
    //   };
    // }
    const fakeJson = {
      publicProjectId: "dd7df2d6",
    };
    const json = fakeJson;
    return {
      success: true,
      data: { publicProjectId: json.publicProjectId },
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to get project id. Check network connection and try again.`,
    };
  }
}
