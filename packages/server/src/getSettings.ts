import { valCredentialHeaders } from "@valbuild/shared/internal";
import { Internal } from "@valbuild/core";
import { z } from "zod";
import { VAL_CLIENT_HEADERS } from "./valClient";

/**
 * The fallback content host.
 *
 * Read at module scope, which is why {@link getSettings} takes an override: a
 * host that bundles its dependencies SEPARATELY from its own code cannot set
 * this. Such a build inlines env vars into the app and leaves dependency chunks
 * alone, so `process.env.VAL_CONTENT_URL` here is whatever it was when the
 * chunk was built -- usually nothing. A caller that knows the content url has
 * to be able to say so.
 *
 * And guarded, because this module runs in a browser too (the demo's in-tab
 * server, `@valbuild/server/browser`): a bundler that does not replace
 * `process.env` leaves a `process` that is not defined there.
 */
const defaultHost = Internal.valHosts().content;

const SettingsSchema = z.object({
  publicProjectId: z.string(),
  remoteFileBuckets: z.array(z.object({ bucket: z.string() })),
  /**
   * The host a new remote file's ref names: the project's own address with
   * `/_val` for a Hosted project whose files are in R2, `remote.val.build`
   * otherwise. Absent from a content service that predates it, where every
   * project's files are on `remote.val.build`.
   */
  remoteHost: z.string().optional(),
});
type Settings = z.infer<typeof SettingsSchema>;

export async function getSettings(
  projectName: string,
  auth: { pat: string } | { apiKey: string },
  /** Overrides {@link defaultHost}. See the note there for why this exists. */
  contentUrl?: string,
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
    const host = contentUrl || defaultHost;
    const response = await fetch(`${host}/v1/${projectName}/settings`, {
      headers: {
        ...VAL_CLIENT_HEADERS,
        ...valCredentialHeaders(auth),
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
