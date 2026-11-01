import {
  AlertTriangle,
  CodeXml,
  Hammer,
  Monitor,
  RotateCw,
  Smartphone,
  Sparkles,
  Tablet,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import { Spinner } from "../designSystem/spinner";
import type { ChangedFile } from "../../design/changedFiles";
import type { DiffLine } from "../../design/lineDiff";
import { DiffArea } from "../design/DesignTabView";

/**
 * Where the proposal's build is, as code mode shows it beside the preview.
 *
 * - `built` -- the preview is the proposal's code as it is now.
 * - `due` -- code changed since the last build, so the preview is behind it:
 *   Save builds (see `ProposalSaveAndBuildButton`).
 * - `building` -- the preview shows the last build until this one is served.
 * - `failed` -- the preview kept the last build that worked.
 * - `unchanged` -- nothing of the code is changed: the proposal runs the
 *   site's.
 */
export type CodeModeBuild =
  | { state: "built"; ago: string }
  | { state: "due" }
  | { state: "building"; step: string | null }
  | { state: "failed"; error: string; onAskAssistant?: () => void }
  | { state: "unchanged" };

export type CodeModeDevice = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTHS: Record<CodeModeDevice, number | null> = {
  desktop: null,
  tablet: 820,
  mobile: 390,
};

/**
 * Code mode's workspace: what takes the editor's and the canvas's place while
 * code mode is on (`TopBarCodeMode.on`), with the assistant docked beside it.
 *
 * The preview is the proposal's BUILD, at its own address -- not the content
 * overlay the canvas draws -- because that is what a code change changes, and
 * Changes is the code against the site's. The content editor is one press
 * away: "Back to content" turns code mode off, as the `</>` does.
 *
 * Presentational: the preview is a slot (an iframe at the proposal's address
 * in the app, a mock in the stories), and so is everything it reports.
 */
export function CodeModeWorkspace({
  route,
  pages,
  onRouteChange,
  onReload,
  preview,
  build,
  files,
  diffOf,
  onExit,
  initialView = "preview",
  initialDevice = "desktop",
}: {
  /** The page in the preview. */
  route: string;
  /** The site's pages, to choose from. */
  pages: string[];
  onRouteChange: (route: string) => void;
  onReload: () => void;
  /** The proposal's page, at `route`. */
  preview: ReactNode;
  build: CodeModeBuild;
  /** What the proposal changes of the site's files. */
  files: ChangedFile[];
  diffOf: (path: string) => DiffLine[];
  /** Turn code mode off: back to editing content. */
  onExit: () => void;
  initialView?: "preview" | "changes";
  initialDevice?: CodeModeDevice;
}) {
  const [view, setView] = useState(initialView);
  const [device, setDevice] = useState(initialDevice);
  const [selected, setSelected] = useState<string | null>(
    files[0]?.path ?? null,
  );
  const file = files.find((each) => each.path === selected) ?? files[0];
  const width = DEVICE_WIDTHS[device];
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border-proposal bg-bg-float shadow-sm">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-float bg-[linear-gradient(var(--bg-proposal-soft),var(--bg-proposal-soft))] px-2 py-1.5">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md bg-bg-proposal px-2 text-xs font-medium text-fg-on-proposal">
          <CodeXml size={14} className="shrink-0" />
          Code mode
        </span>
        <div
          role="tablist"
          aria-label="What code mode shows"
          className="inline-flex h-7 items-center rounded-md border border-border-float p-0.5"
        >
          <ViewTab
            selected={view === "preview"}
            onClick={() => setView("preview")}
          >
            Preview
          </ViewTab>
          <ViewTab
            selected={view === "changes"}
            onClick={() => setView("changes")}
          >
            Changes
            {files.length > 0 && (
              <span className="tabular-nums text-fg-secondary-alt">
                {files.length}
              </span>
            )}
          </ViewTab>
        </div>
        {view === "preview" && (
          <>
            <select
              aria-label="Page"
              value={route}
              onChange={(event) => onRouteChange(event.target.value)}
              className="h-7 max-w-48 rounded-md border border-border-float bg-bg-float px-2 font-mono text-xs text-fg-primary"
            >
              {pages.map((page) => (
                <option key={page} value={page}>
                  {page}
                </option>
              ))}
            </select>
            <div className="hidden items-center md:inline-flex">
              <DeviceButton
                label="Desktop"
                active={device === "desktop"}
                onClick={() => setDevice("desktop")}
              >
                <Monitor size={14} />
              </DeviceButton>
              <DeviceButton
                label="Tablet"
                active={device === "tablet"}
                onClick={() => setDevice("tablet")}
              >
                <Tablet size={14} />
              </DeviceButton>
              <DeviceButton
                label="Phone"
                active={device === "mobile"}
                onClick={() => setDevice("mobile")}
              >
                <Smartphone size={14} />
              </DeviceButton>
            </div>
            <DeviceButton label="Reload the preview" onClick={onReload}>
              <RotateCw size={13} />
            </DeviceButton>
          </>
        )}
        <div className="flex-1" />
        <BuildStatus build={build} />
        <button
          type="button"
          onClick={onExit}
          title="Turn code mode off, and edit content again"
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <X size={13} className="shrink-0" />
          <span className="hidden lg:inline">Back to content</span>
        </button>
      </div>
      {build.state === "due" && view === "preview" && (
        <Banner tone="info">
          The preview shows the last build. Code changed since: press{" "}
          <span className="font-medium text-fg-primary">Save</span> to build it.
        </Banner>
      )}
      {build.state === "failed" && (
        <Banner
          tone="error"
          action={
            build.onAskAssistant !== undefined
              ? {
                  label: "Ask the assistant to fix it",
                  onClick: build.onAskAssistant,
                }
              : undefined
          }
          details={build.error}
        >
          The build failed, so the preview kept the last build that worked. Save
          builds again.
        </Banner>
      )}
      {view === "preview" ? (
        <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-bg-canvas p-3">
          <div
            className="relative h-full w-full overflow-auto rounded-md border border-border-float bg-white shadow-sm"
            style={width === null ? undefined : { maxWidth: width }}
          >
            {preview}
            {build.state === "building" && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-bg-proposal-soft">
                <div className="h-full w-1/3 animate-pulse bg-bg-proposal" />
              </div>
            )}
          </div>
        </div>
      ) : files.length === 0 || file === undefined ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <p className="max-w-sm text-center text-sm text-fg-secondary">
            No code is changed yet: the proposal runs the site&rsquo;s code. Ask
            the assistant for a change, and it shows up here.
          </p>
        </div>
      ) : (
        <DiffArea
          files={files}
          file={file}
          onSelect={setSelected}
          lines={diffOf(file.path)}
        />
      )}
    </div>
  );
}

function ViewTab({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "inline-flex h-full items-center gap-1 rounded px-2 text-xs font-medium",
        selected
          ? "bg-bg-float-raised text-fg-primary"
          : "text-fg-secondary hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

function DeviceButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-md",
        active
          ? "bg-bg-float-raised text-fg-primary"
          : "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

function BuildStatus({ build }: { build: CodeModeBuild }) {
  const { dot, label, title } = (() => {
    switch (build.state) {
      case "built":
        return {
          dot: "bg-bg-brand-primary",
          label: `Built ${build.ago}`,
          title: "The preview shows the proposal's code as it is now.",
        };
      case "due":
        return {
          dot: "bg-bg-warning-primary",
          label: "Not built",
          title: "Code changed since the last build. Save builds it.",
        };
      case "building":
        return {
          dot: null,
          label: build.step ?? "Building…",
          title:
            "Building the proposal's code. The preview shows the last build until this one is served.",
        };
      case "failed":
        return {
          dot: "bg-bg-error-primary",
          label: "Build failed",
          title: build.error,
        };
      case "unchanged":
        return {
          dot: "bg-fg-disabled",
          label: "Site's code",
          title:
            "Nothing of the code is changed: the proposal runs the site's.",
        };
    }
  })();
  return (
    <span
      role="status"
      title={title}
      className="inline-flex h-7 max-w-56 items-center gap-1.5 px-1 text-xs text-fg-secondary"
    >
      {dot === null ? (
        <Spinner size={12} />
      ) : (
        <span
          aria-hidden
          className={cn("h-2 w-2 shrink-0 rounded-full", dot)}
        />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

function Banner({
  tone,
  children,
  details,
  action,
}: {
  tone: "info" | "error";
  children: ReactNode;
  /** What went wrong, verbatim, behind a disclosure. */
  details?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex shrink-0 flex-wrap items-start gap-x-3 gap-y-1 border-b px-3 py-2 text-xs",
        tone === "error"
          ? "border-border-error-primary bg-bg-error-secondary text-fg-primary"
          : "border-border-float bg-bg-float-raised text-fg-secondary",
      )}
    >
      {tone === "error" ? (
        <AlertTriangle
          size={14}
          className="mt-px shrink-0 text-fg-error-on-surface"
        />
      ) : (
        <Hammer size={14} className="mt-px shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p>{children}</p>
        {details !== undefined && (
          <details className="mt-1">
            <summary className="cursor-pointer text-fg-secondary">
              Details
            </summary>
            <pre className="mt-1 whitespace-pre-wrap font-mono text-[0.6875rem] text-fg-secondary">
              {details}
            </pre>
          </details>
        )}
      </div>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border-float bg-bg-float px-2 text-xs font-medium text-fg-primary hover:bg-bg-float-raised"
        >
          <Sparkles size={13} className="shrink-0" />
          {action.label}
        </button>
      )}
    </div>
  );
}
