import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  ExternalLink,
  FileCode2,
  GitBranch,
  Hammer,
  History,
  Monitor,
  Paintbrush,
  RotateCw,
  Smartphone,
  Sparkles,
  Tablet,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import { Spinner } from "../designSystem/spinner";
import type { ChangedFile, FileChange } from "../../design/changedFiles";
import type { DiffLine } from "../../design/lineDiff";

/**
 * The design tab, as it looks (valbuild/home `docs/design-tab.md`): a
 * proposal's code, changed by the assistant and previewed, in a tab of its own
 * served by the SITE's build -- so it stays up when the proposal's code does
 * not. `DesignTab` wires it; this is only what it shows.
 *
 * - Left: what the proposal changes of the site's files, and its history.
 * - Middle: the proposal's address in a frame, or a file against the site's.
 * - Right: the assistant, whose code tools act on this proposal.
 * - Top: the checks a change goes through, the build, and the proposal's
 *   own Studio, where its content is edited and it is published.
 *
 * A build that does not render is never served (step 1), so a failed build
 * does not take the preview away: it says so above the last build that
 * rendered, which the frame keeps showing.
 */

export type DesignCheck =
  | { state: "idle"; detail?: string }
  | { state: "running"; percent?: number | null }
  | { state: "passed"; detail?: string }
  | { state: "failed"; message: string };

export type DesignCheckItem = { label: string; check: DesignCheck };

export type DesignBuilder =
  /** Chrome and Firefox: the bundler runs in this tab. */
  | { kind: "in-tab" }
  /**
   * Safari: the bundler needs a cross-origin isolated window of its own.
   * `blocked` while the browser has not let it open: Open it from a tap.
   */
  | { kind: "window"; blocked: boolean };

export type DesignCheckpoint = {
  id: string;
  message: string;
  ago: string;
  current?: boolean;
};

/** Something that went wrong, with what the person can do about it. */
export type DesignProblem = {
  title: string;
  message: string;
  /** What support would need: the raw error. Behind a disclosure. */
  details?: string;
  onAskAssistant?: () => void;
  action?: { label: string; onClick: () => void };
};

export type DesignDevice = "desktop" | "tablet" | "mobile";
export type DesignView = "preview" | "changes";

export type DesignTabViewProps = {
  proposal: { displayName: string; address: string | null };
  /** The page the frame shows, to open in a tab of its own; `null`: none. */
  previewHref: string | null;
  /** The proposal's own Studio: its content, and Publish. */
  studioUrl: string | null;
  route: string;
  onRouteChange: (route: string) => void;
  onReload: () => void;
  /** `null` while they are read. */
  files: ChangedFile[] | null;
  /** The diff of one of `files` against the site's copy. */
  diffOf: (path: string) => DiffLine[];
  /** `null` while it is read; absent when there is none to show. */
  checkpoints: DesignCheckpoint[] | null;
  checks: DesignCheckItem[];
  build: {
    /** Files are staged that the address does not serve yet. */
    required: boolean;
    building: boolean;
    progress: { label: string; percent: number | null } | null;
    /** `null`: nothing to build here. */
    onBuild: (() => void) | null;
  };
  builder: DesignBuilder;
  onOpenBuilder?: () => void;
  problem: DesignProblem | null;
  /** The frame: the proposal's page at `route`. */
  preview: ReactNode;
  /** The assistant. */
  chat: ReactNode;
  initialView?: DesignView;
  initialDevice?: DesignDevice;
};

const VIEWS: DesignView[] = ["preview", "changes"];

const DEVICE_WIDTHS: Record<DesignDevice, number | null> = {
  desktop: null,
  tablet: 820,
  mobile: 390,
};

export function DesignTabView(props: DesignTabViewProps) {
  const [view, setView] = useState<DesignView>(props.initialView ?? "preview");
  const [device, setDevice] = useState<DesignDevice>(
    props.initialDevice ?? "desktop",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const files = props.files ?? [];
  const shownFile =
    files.find((file) => file.path === selected) ?? files[0] ?? null;
  return (
    <div className="flex h-svh flex-col bg-bg-primary text-fg-primary">
      <DesignTopBar {...props} />
      {props.builder.kind === "window" &&
        props.builder.blocked &&
        props.onOpenBuilder !== undefined && (
          <BuilderWindowBanner onOpen={props.onOpenBuilder} />
        )}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border-primary bg-bg-secondary">
          <ChangedFiles
            files={props.files}
            selected={view === "changes" ? (shownFile?.path ?? null) : null}
            onSelect={(path) => {
              setSelected(path);
              setView("changes");
            }}
          />
          {props.checkpoints !== null && props.checkpoints.length > 0 && (
            <Checkpoints checkpoints={props.checkpoints} />
          )}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-bg-canvas">
          <PreviewToolbar
            route={props.route}
            onRouteChange={props.onRouteChange}
            onReload={props.onReload}
            address={props.proposal.address}
            previewHref={props.previewHref}
            view={view}
            onView={setView}
            device={device}
            onDevice={setDevice}
            changes={files.length}
          />
          {props.problem !== null && <ProblemBanner problem={props.problem} />}
          {view === "preview" ? (
            <PreviewArea
              address={props.proposal.address}
              building={props.build.building}
              progress={props.build.progress}
              device={device}
              preview={props.preview}
            />
          ) : shownFile === null ? (
            <Empty>
              Nothing is changed from the site yet. Ask the assistant for a
              change, and the files it writes are shown here.
            </Empty>
          ) : (
            <DiffArea file={shownFile} lines={props.diffOf(shownFile.path)} />
          )}
        </main>
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-border-primary">
          {props.chat}
        </aside>
      </div>
    </div>
  );
}

function DesignTopBar({
  proposal,
  studioUrl,
  checks,
  builder,
  build,
}: DesignTabViewProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border-primary px-3">
      <span className="inline-flex items-center gap-1.5 rounded-md bg-bg-proposal px-2 py-1 text-xs font-semibold text-fg-on-proposal">
        <Paintbrush size={14} />
        Design
      </span>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
        <GitBranch size={14} className="shrink-0 text-fg-proposal" />
        <span className="truncate font-medium">{proposal.displayName}</span>
      </span>
      <div className="mx-auto flex items-center gap-1.5">
        {checks.map((item, index) => (
          <span key={item.label} className="inline-flex items-center gap-1.5">
            {index > 0 && (
              <ChevronRight size={12} className="text-fg-tertiary" />
            )}
            <CheckChip label={item.label} check={item.check} />
          </span>
        ))}
        {builder.kind === "window" && (
          <span
            className={cn(
              "ml-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
              builder.blocked
                ? "border-border-warning-primary text-fg-warning-primary"
                : "border-border-primary text-fg-secondary",
            )}
            title="This browser builds in a window of its own. This tab shows the preview."
          >
            <Hammer size={12} />
            {builder.blocked ? "No builder window" : "Builds in a window"}
          </span>
        )}
      </div>
      {build.onBuild !== null && (build.required || build.building) && (
        <button
          type="button"
          onClick={build.onBuild}
          disabled={build.building}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-proposal px-3 text-xs font-medium text-fg-primary hover:bg-bg-proposal-soft disabled:text-fg-disabled"
        >
          {build.building ? <Spinner size={14} /> : <Hammer size={14} />}
          {build.building ? "Building…" : "Build"}
        </button>
      )}
      {studioUrl !== null && (
        <a
          href={studioUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-fg-secondary hover:bg-bg-secondary"
          title="Its content, and Publish, are in the proposal's own Studio"
        >
          Open the proposal&apos;s Studio
          <ExternalLink size={12} />
        </a>
      )}
    </header>
  );
}

function CheckChip({ label, check }: { label: string; check: DesignCheck }) {
  return (
    <span
      title={check.state === "failed" ? check.message : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
        check.state === "passed" &&
          "bg-bg-brand-secondary text-fg-brand-secondary",
        check.state === "failed" && "bg-bg-error-primary text-fg-error-primary",
        check.state === "running" && "bg-bg-secondary text-fg-primary",
        check.state === "idle" && "bg-bg-secondary text-fg-tertiary",
      )}
    >
      {check.state === "passed" && <Check size={12} />}
      {check.state === "failed" && <X size={12} />}
      {check.state === "running" && <Spinner size={12} />}
      {check.state === "idle" && <Circle size={10} />}
      {label}
      {(check.state === "passed" || check.state === "idle") &&
        check.detail !== undefined && (
          <span className="opacity-70">{check.detail}</span>
        )}
      {check.state === "running" &&
        check.percent !== undefined &&
        check.percent !== null && (
          <span className="tabular-nums opacity-70">{check.percent}%</span>
        )}
    </span>
  );
}

function BuilderWindowBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-border-warning-primary bg-bg-warning-primary px-4 py-2 text-xs text-fg-warning-primary">
      <Hammer size={14} className="shrink-0" />
      <span>
        This browser builds in a window of its own, so this tab can show the
        preview. Open it, and the build waiting for it starts there.
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-bg-warning-secondary px-3 font-medium text-fg-warning-secondary hover:bg-bg-warning-secondary-hover"
      >
        Open the builder window
      </button>
    </div>
  );
}

const CHANGE_MARK: Record<FileChange, { letter: string; tone: string }> = {
  added: { letter: "A", tone: "bg-bg-brand-secondary text-fg-brand-secondary" },
  modified: {
    letter: "M",
    tone: "bg-bg-warning-secondary text-fg-warning-secondary",
  },
  deleted: { letter: "D", tone: "bg-bg-error-primary text-fg-error-primary" },
};

function ChangeMark({ change }: { change: FileChange }) {
  const mark = CHANGE_MARK[change];
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold",
        mark.tone,
      )}
    >
      {mark.letter}
    </span>
  );
}

function ChangedFiles({
  files,
  selected,
  onSelect,
}: {
  files: ChangedFile[] | null;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <section className="flex flex-col border-b border-border-primary py-2">
      <h2 className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
        <FileCode2 size={12} />
        Changed from the site
        {files !== null && (
          <span className="ml-auto tabular-nums">{files.length}</span>
        )}
      </h2>
      {files === null ? (
        <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-fg-secondary">
          <Spinner size={12} /> Reading the proposal&apos;s files
        </div>
      ) : files.length === 0 ? (
        <p className="px-4 py-1.5 text-xs text-fg-secondary">
          Nothing yet: the proposal runs the site&apos;s code.
        </p>
      ) : (
        <ul>
          {files.map((file) => {
            const slash = file.path.lastIndexOf("/");
            const dir = file.path.slice(0, slash + 1);
            const name = file.path.slice(slash + 1);
            return (
              <li key={file.path}>
                <button
                  type="button"
                  onClick={() => onSelect(file.path)}
                  title={file.path}
                  className={cn(
                    "flex w-full items-center gap-2 px-4 py-1 text-left text-xs hover:bg-bg-secondary-hover",
                    selected === file.path && "bg-bg-secondary-hover",
                  )}
                >
                  <ChangeMark change={file.change} />
                  <span className="min-w-0 truncate">
                    <span
                      className={cn(
                        file.change === "deleted" && "line-through",
                      )}
                    >
                      {name}
                    </span>{" "}
                    <span className="text-fg-tertiary">{dir}</span>
                  </span>
                  {!file.staged && (
                    <span
                      className="ml-auto shrink-0 text-[10px] text-fg-tertiary"
                      title="Changed by a save of its content, not staged as code"
                    >
                      content
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Checkpoints({ checkpoints }: { checkpoints: DesignCheckpoint[] }) {
  return (
    <section className="flex min-h-0 flex-col py-2">
      <h2 className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
        <History size={12} />
        History
      </h2>
      <ol>
        {checkpoints.map((checkpoint) => (
          <li
            key={checkpoint.id}
            className="flex items-start gap-2 px-4 py-1.5 text-xs"
          >
            <Circle
              size={8}
              className={cn(
                "mt-1 shrink-0",
                checkpoint.current
                  ? "fill-current text-fg-proposal"
                  : "text-fg-tertiary",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{checkpoint.message}</span>
              <span className="text-fg-tertiary">
                {checkpoint.current ? "Now · " : ""}
                {checkpoint.ago}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PreviewToolbar({
  route,
  onRouteChange,
  onReload,
  address,
  previewHref,
  view,
  onView,
  device,
  onDevice,
  changes,
}: {
  route: string;
  onRouteChange: (route: string) => void;
  onReload: () => void;
  address: string | null;
  previewHref: string | null;
  view: DesignView;
  onView: (view: DesignView) => void;
  device: DesignDevice;
  onDevice: (device: DesignDevice) => void;
  changes: number;
}) {
  const [draft, setDraft] = useState(route);
  useEffect(() => setDraft(route), [route]);
  const devices: { device: DesignDevice; icon: ReactNode; label: string }[] = [
    { device: "desktop", icon: <Monitor size={14} />, label: "Desktop" },
    { device: "tablet", icon: <Tablet size={14} />, label: "Tablet" },
    { device: "mobile", icon: <Smartphone size={14} />, label: "Phone" },
  ];
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-primary bg-bg-primary px-3">
      <div className="flex rounded-md bg-bg-secondary p-0.5 text-xs">
        {VIEWS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onView(option)}
            className={cn(
              "rounded px-2.5 py-1",
              view === option
                ? "bg-bg-primary font-medium shadow-sm"
                : "text-fg-secondary",
            )}
          >
            {option === "preview" ? "Preview" : `Changes · ${changes}`}
          </button>
        ))}
      </div>
      {view === "preview" && (
        <>
          <form
            className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-border-primary bg-bg-secondary px-2 font-mono text-xs"
            onSubmit={(event) => {
              event.preventDefault();
              onRouteChange(draft.startsWith("/") ? draft : `/${draft}`);
            }}
          >
            {address !== null && (
              <span className="shrink truncate text-fg-tertiary">
                {address.replace(/\/$/, "")}
              </span>
            )}
            <input
              aria-label="Page"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="min-w-[6rem] flex-1 bg-transparent outline-none"
            />
          </form>
          <div className="flex items-center">
            {devices.map((option) => (
              <button
                key={option.device}
                type="button"
                title={option.label}
                aria-label={option.label}
                onClick={() => onDevice(option.device)}
                className={cn(
                  "rounded p-1.5",
                  device === option.device
                    ? "bg-bg-secondary text-fg-primary"
                    : "text-fg-tertiary hover:text-fg-primary",
                )}
              >
                {option.icon}
              </button>
            ))}
          </div>
          <button
            type="button"
            title="Reload"
            aria-label="Reload"
            onClick={onReload}
            className="rounded p-1.5 text-fg-secondary hover:bg-bg-secondary"
          >
            <RotateCw size={14} />
          </button>
          {previewHref !== null && (
            <a
              href={previewHref}
              target="_blank"
              rel="noreferrer"
              title="Open the proposal's address in a tab of its own"
              aria-label="Open the proposal's address in a tab of its own"
              className="rounded p-1.5 text-fg-secondary hover:bg-bg-secondary"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </>
      )}
    </div>
  );
}

function ProblemBanner({ problem }: { problem: DesignProblem }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="shrink-0 border-b border-border-error-primary bg-bg-primary px-4 py-3 text-xs">
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={16}
          className="mt-px shrink-0 text-fg-error-on-surface"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg-error-on-surface">
            {problem.title}
          </p>
          <p className="mt-0.5 text-fg-secondary">{problem.message}</p>
          {problem.details !== undefined && (
            <>
              <button
                type="button"
                onClick={() => setShowDetails((shown) => !shown)}
                className="mt-1 inline-flex items-center gap-1 text-fg-secondary hover:text-fg-primary"
              >
                <ChevronRight
                  size={12}
                  className={cn(
                    "transition-transform",
                    showDetails && "rotate-90",
                  )}
                />
                Details
              </button>
              {showDetails && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-secondary p-2 font-mono text-[11px] leading-relaxed text-fg-secondary">
                  {problem.details}
                </pre>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {problem.onAskAssistant !== undefined && (
            <button
              type="button"
              onClick={problem.onAskAssistant}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-bg-proposal px-2.5 font-medium text-fg-on-proposal hover:bg-bg-proposal-hover"
            >
              <Sparkles size={12} />
              Ask the assistant to fix it
            </button>
          )}
          {problem.action !== undefined && (
            <button
              type="button"
              onClick={problem.action.onClick}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border-primary px-2.5 hover:bg-bg-secondary"
            >
              {problem.action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewArea({
  address,
  building,
  progress,
  device,
  preview,
}: {
  address: string | null;
  building: boolean;
  progress: { label: string; percent: number | null } | null;
  device: DesignDevice;
  preview: ReactNode;
}) {
  const width = DEVICE_WIDTHS[device];
  if (address === null) {
    return (
      <Empty>
        The proposal&apos;s address is being set up. The preview appears here
        when it is ready.
      </Empty>
    );
  }
  if (preview === null) {
    return (
      <Empty>
        That is not a page of this proposal. Type its path, starting with /.
      </Empty>
    );
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {building && (
        <div className="flex items-center gap-3 border-b border-border-primary bg-bg-primary px-4 py-2 text-xs">
          <Spinner size={12} />
          <span>
            {progress?.label ?? "Building"}. Until it is done, this is the last
            build.
          </span>
          {progress?.percent !== null && progress?.percent !== undefined && (
            <div className="ml-auto h-1 w-40 overflow-hidden rounded-full bg-bg-secondary">
              <div
                className="h-full bg-bg-proposal"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 justify-center overflow-hidden p-4">
        <div
          className={cn(
            "relative h-full w-full overflow-hidden rounded-lg border border-border-primary bg-white shadow-lg",
            building && "opacity-60",
          )}
          style={width === null ? undefined : { maxWidth: width }}
        >
          {preview}
        </div>
      </div>
    </div>
  );
}

function DiffArea({ file, lines }: { file: ChangedFile; lines: DiffLine[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
        <div className="flex items-center gap-2 border-b border-border-primary px-4 py-2 font-mono text-xs">
          <ChangeMark change={file.change} />
          {file.path}
          <span className="ml-auto font-sans text-fg-tertiary">
            Compared with the site
          </span>
        </div>
        <pre className="flex-1 overflow-auto py-2 font-mono text-xs leading-5">
          {lines.map((line, index) =>
            line.kind === "skip" ? (
              <div
                key={index}
                className="select-none px-4 text-fg-tertiary italic"
              >
                ⋯ {line.count} unchanged {line.count === 1 ? "line" : "lines"}
              </div>
            ) : (
              <div
                key={index}
                className={cn(
                  "flex px-4",
                  line.kind === "added" &&
                    "bg-bg-brand-secondary text-fg-brand-secondary",
                  line.kind === "removed" &&
                    "bg-bg-error-primary text-fg-error-primary",
                )}
              >
                <span className="w-5 shrink-0 select-none opacity-60">
                  {line.kind === "added"
                    ? "+"
                    : line.kind === "removed"
                      ? "-"
                      : " "}
                </span>
                <span className="whitespace-pre">{line.text}</span>
              </div>
            ),
          )}
        </pre>
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <p className="max-w-sm text-center text-sm text-fg-secondary">
        {children}
      </p>
    </div>
  );
}
