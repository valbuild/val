import type { ReactNode } from "react";
import { useValMode } from "../ValProvider";
import { useValConfig } from "../ValFieldProvider";
import { useValWebComponent } from "./ProjectSwitcher";
import { toAdminLinks, toWebComponentsUrl } from "./shellDataMapping";
import { useValBuildAccess } from "./useValBuildAccess";

/**
 * `<val-site-errors>`, what the hosted site's server threw or warned lately,
 * grouped, with which ones the live build brought (valbuild/home,
 * `web-components/src/site-errors`; `docs/site-errors.md` there).
 *
 * Mounted under the same rules as the AI setup -- a connected project, and
 * Val Build reachable (after `val login` locally) -- and otherwise nothing.
 * `ValShell` offers it only to a project on Hosted, the one plan whose site
 * Val Build serves and so can see the errors of. The fallback, until the
 * element has loaded or when it cannot, is the project's page in Val Build.
 */
export function SiteErrors({
  className,
  unavailable = null,
  loadScript,
}: {
  className?: string;
  /** What to show when it cannot be mounted (a project not connected). */
  unavailable?: ReactNode;
  /** For tests: the real one adds a `<script>` to the page. */
  loadScript?: (src: string) => Promise<void>;
}) {
  const config = useValConfig();
  const mode = useValMode();
  const valBuild = useValBuildAccess(mode);
  const admin = toAdminLinks(config);
  const webComponentsUrl = toWebComponentsUrl(config);
  if (
    !valBuild.connected ||
    admin === undefined ||
    webComponentsUrl === undefined
  ) {
    return <>{unavailable}</>;
  }
  return (
    <SiteErrorsElement
      className={className}
      project={config?.project ?? ""}
      projectHref={admin.project}
      webComponentsUrl={webComponentsUrl}
      studioMode={valBuild.studioMode}
      loadScript={loadScript}
    />
  );
}

export function SiteErrorsElement({
  className,
  project,
  projectHref,
  webComponentsUrl,
  studioMode,
  loadScript,
}: {
  className?: string;
  /** `org/name`. */
  project: string;
  projectHref: string;
  webComponentsUrl: string;
  studioMode?: "fs" | "http";
  loadScript?: (src: string) => Promise<void>;
}) {
  const ref = useValWebComponent(
    `${webComponentsUrl}/site-errors.js`,
    loadScript,
  );
  return (
    <val-site-errors
      ref={ref}
      className={className}
      project={project}
      api-base="/api/val/admin/proxy"
      mode={studioMode}
    >
      <a
        href={projectHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
      >
        See this site in Val Build
      </a>
    </val-site-errors>
  );
}
