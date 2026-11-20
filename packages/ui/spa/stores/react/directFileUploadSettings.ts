import { Internal } from "@valbuild/core";
import type { ValClient } from "@valbuild/shared/internal";
import type { UploadSettings } from "./createValSystem";

/**
 * Where a patch's file bytes are POSTed, and with what credentials: asked of
 * the server per upload (`/direct-file-upload-settings`), with a few retries
 * when it cannot be reached at all. The `uploadSettings` the Studio gives its
 * system (`ValProvider`).
 *
 * Its own function, out of the provider, so the scenario harness
 * (`scenarios/`) uploads to the same place the Studio does.
 */
export async function directFileUploadSettings(
  client: ValClient,
): ReturnType<UploadSettings> {
  let res = await client("/direct-file-upload-settings", "POST", {});
  let retries = 0;
  while (res.status === null && retries < 5) {
    Internal.log.debug(
      "Failed to get direct file upload settings, retrying...",
      res,
    );
    await new Promise((resolve) => setTimeout(resolve, 500 * (retries + 1)));
    res = await client("/direct-file-upload-settings", "POST", {});
    retries++;
  }
  if (res.status === 200) {
    return { status: "success", data: res.json };
  }
  return {
    status: "error",
    error: "Could not get direct file upload settings",
  };
}
