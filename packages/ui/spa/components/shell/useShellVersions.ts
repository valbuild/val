import { useMemo } from "react";
import { Internal } from "@valbuild/core";
/*
 * A default import, not `import { version }`, for the reason
 * `@valbuild/next`'s `version.ts` gives: preconstruct's JSON plugin has no
 * named exports. And this package's own `package.json` rather than `VERSION`
 * from `src/`, which is a build placeholder until the Studio is published, so
 * in development it would show the placeholder.
 */
import uiPackageJson from "../../../package.json";
import { useClient } from "../ValProvider";
import { ShellServerVersions, ShellVersions } from "./types";

/** The versions for the account panel's list. See `VersionList`. */
export function useShellVersions(): ShellVersions {
  const client = useClient();
  return useMemo<ShellVersions>(
    () => ({
      studio: { ui: uiPackageJson.version, core: Internal.VERSION.core },
      loadServer: async (): Promise<ShellServerVersions> => {
        const res = await client("/versions", "GET", {});
        if (res.status === 200) {
          return { status: "success", ...res.json };
        }
        if (res.status === 404) {
          return { status: "unsupported" };
        }
        return { status: "error", message: res.json.message };
      },
    }),
    [client],
  );
}
