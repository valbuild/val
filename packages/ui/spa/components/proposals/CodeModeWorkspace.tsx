import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import type { ChangedFile } from "../../design/changedFiles";
import type { DiffLine } from "../../design/lineDiff";
import { DiffArea } from "../design/DesignTabView";
import {
  CodeModeProgressLine,
  CodeModeStatus,
  type CodeModeBuild,
  type CodeModeStatusVariant,
} from "./CodeModeStatus";

export type { CodeModeBuild, CodeModeStatusVariant } from "./CodeModeStatus";

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
 * The preview is the proposal's own site, as its code is now -- not the
 * content overlay the canvas draws -- and Changes is its code against the
 * site's.
 *
 * Quiet on purpose. The one switch for code mode is the `</>` beside the
 * proposal switcher, so there is no second one here, and no banner: whether
 * the preview is up to date lives in the reload button (`CodeModeStatus`),
 * which keeps one width in every state, so nothing moves when it changes.
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
  statusVariant = "reload",
  files,
  diffOf,
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
  /** How the status is shown: see `CodeModeStatusVariant`. */
  statusVariant?: CodeModeStatusVariant;
  /** What the proposal changes of the site's files. */
  files: ChangedFile[];
  diffOf: (path: string) => DiffLine[];
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
      <div className="relative flex h-10 shrink-0 items-center gap-2 border-b border-border-float px-2">
        <div
          role="tablist"
          aria-label="What code mode shows"
          className="inline-flex h-7 shrink-0 items-center rounded-md border border-border-float p-0.5"
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
              className="h-7 min-w-0 max-w-48 rounded-md border border-border-float bg-bg-float px-2 font-mono text-xs text-fg-primary"
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
          </>
        )}
        <div className="flex-1" />
        {/* At the end of the bar, in both views: the one thing that changes. */}
        <CodeModeStatus
          build={build}
          variant={statusVariant}
          onReload={onReload}
        />
        {statusVariant === "line" && <CodeModeProgressLine build={build} />}
      </div>
      {view === "preview" ? (
        <div className="flex min-h-0 flex-1 justify-center overflow-hidden bg-bg-canvas p-3">
          <div
            className="relative h-full w-full overflow-auto rounded-md border border-border-float bg-white shadow-sm"
            style={width === null ? undefined : { maxWidth: width }}
          >
            {preview}
          </div>
        </div>
      ) : files.length === 0 || file === undefined ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <p className="max-w-sm text-center text-sm text-fg-secondary">
            No code is changed yet. Ask the assistant for a change, and it shows
            up here.
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
        "inline-flex h-full items-center gap-1 whitespace-nowrap rounded px-2 text-xs font-medium",
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
