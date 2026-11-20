import { useMemo, type ReactNode } from "react";
import { Internal } from "@valbuild/core";
import { VAL_STUDIO_HEADER } from "@valbuild/shared/internal";
import { useClient, useValMode } from "../components/ValProvider";
import { useValConfig } from "../components/ValFieldProvider";
import { useValBuildAccess } from "../components/shell/useValBuildAccess";
import {
  ContentAnalyticsContext,
  createContentAnalyticsStore,
  type ContentAnalyticsStore,
} from "./ContentAnalytics";

/**
 * Where the badges' numbers come from: Val Build, through this app's
 * `/api/val/admin/proxy`, with the editor's credential. Mounted once, by the
 * shell; kept out of `ContentAnalytics.tsx` so a field that shows a badge
 * does not import the Studio's client.
 */
export function ContentAnalyticsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const client = useClient();
  const project = useValConfig()?.project;
  const mode = useValMode();
  const { connected } = useValBuildAccess(mode);
  const [org, name, ...rest] = project?.split("/") ?? [];
  const projectPath =
    connected && org && name && rest.length === 0
      ? `/orgs/${encodeURIComponent(org)}/projects/${encodeURIComponent(name)}`
      : null;

  const store = useMemo((): ContentAnalyticsStore | null => {
    if (projectPath === null) return null;
    return createContentAnalyticsStore(async (module) => {
      const res = await client("/admin/proxy", "GET", {
        path: `${projectPath}/analytics/module?module=${encodeURIComponent(module)}`,
        body: undefined,
        headers: { [VAL_STUDIO_HEADER]: "1" },
      });
      if (res.status !== 200) {
        Internal.log.debug("content analytics not shown", res.json);
        return null;
      }
      return res.json;
    });
  }, [client, projectPath]);

  return (
    <ContentAnalyticsContext.Provider value={store}>
      {children}
    </ContentAnalyticsContext.Provider>
  );
}
