import { useEffect } from "react";
import { ScrollText, X } from "lucide-react";
import { useValConfig } from "../ValFieldProvider";
import { useValWebComponent } from "./ProjectSwitcher";
import { toAdminLinks, toWebComponentsUrl } from "./shellDataMapping";
import type { ValBuildAccess } from "./useValBuildAccess";

/**
 * `<val-logs>`, a hosted site's requests and what they printed, with live
 * tail, and its errors grouped (valbuild/home, `web-components/src/logs`).
 *
 * Two places, one element:
 *
 * - Settings › Logs, at the foot of the rail: the summary. Whether the site is
 *   failing now, its worst errors, the last few requests, and Open logs.
 * - Open logs: the whole page, in the preview's place (`LogsInPreviewsPlace`),
 *   as History is. The editor stays where it was.
 *
 * Offered only to a project on Hosted: Val Build sees a site's requests
 * because it serves the site, so on any other plan there is nothing to show.
 */
export type LogsTarget = {
  /** `org/name`. */
  project: string;
  /** The project's Logs section in Val Build. */
  adminHref: string;
  webComponentsUrl: string;
  studioMode?: "fs" | "http";
};

export function useLogsTarget(
  valBuild: ValBuildAccess,
  hosted: boolean,
): LogsTarget | null {
  const config = useValConfig();
  const admin = toAdminLinks(config);
  const webComponentsUrl = toWebComponentsUrl(config);
  if (
    !hosted ||
    !valBuild.connected ||
    admin === undefined ||
    webComponentsUrl === undefined
  ) {
    return null;
  }
  return {
    project: config?.project ?? "",
    adminHref: `${admin.project}/logs`,
    webComponentsUrl,
    studioMode: valBuild.studioMode,
  };
}

export function LogsElement({
  className,
  layout,
  project,
  adminHref,
  webComponentsUrl,
  studioMode,
  onOpen,
  loadScript,
}: LogsTarget & {
  className?: string;
  layout: "summary" | "page";
  /** The summary's Open logs (`val-open-logs`). */
  onOpen?: () => void;
  /** For tests: the real one adds a `<script>` to the page. */
  loadScript?: (src: string) => Promise<void>;
}) {
  const ref = useValWebComponent(`${webComponentsUrl}/logs.js`, loadScript);
  useEffect(() => {
    const element = ref.current;
    if (element === null || onOpen === undefined) {
      return;
    }
    const open = () => onOpen();
    element.addEventListener("val-open-logs", open);
    return () => element.removeEventListener("val-open-logs", open);
  }, [ref, onOpen]);
  return (
    <val-logs
      ref={ref}
      className={className}
      project={project}
      api-base="/api/val/admin/proxy"
      layout={layout}
      mode={studioMode}
      admin-url={adminHref}
    >
      <a
        href={adminHref}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-fg-secondary underline underline-offset-2 hover:text-fg-primary"
      >
        Logs in Val Build
      </a>
    </val-logs>
  );
}

/** Settings' Logs tab, as `SettingsTabs` takes one. */
export const LOGS_TAB_ICON = ScrollText;

/**
 * The whole Logs page where the preview is, with the way back above it, as
 * History is shown. Not a destination of the rail: it is opened from
 * Settings, and closing it puts the preview back.
 */
export function LogsInPreviewsPlace({
  target,
  onClose,
}: {
  target: LogsTarget;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-val-pane="logs">
      <div className="flex h-8 shrink-0 items-center gap-2 px-1 text-xs font-medium text-fg-secondary">
        <ScrollText size={14} aria-hidden />
        Logs
        <button
          type="button"
          onClick={onClose}
          className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <X size={14} aria-hidden />
          Back to the preview
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border-float bg-bg-float">
        <LogsElement className="block h-full" layout="page" {...target} />
      </div>
    </div>
  );
}
