import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  ExternalLink,
  FileCode2,
  FolderTree,
  GitBranch,
  Hammer,
  History,
  Monitor,
  Paintbrush,
  RotateCcw,
  RotateCw,
  Smartphone,
  Sparkles,
  Tablet,
  Upload,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { AIChat, type ChatMessage } from "../../AIChat";
import { cn } from "../../designSystem/cn";
import { Spinner } from "../../designSystem/spinner";

/**
 * A SKETCH of the design tab: a proposal's code, changed by the assistant and
 * previewed, in a tab of its own served by the SITE's build -- so it stays up
 * when the proposal's code does not. Nothing here is wired to anything; it is
 * the layout and the states, to argue about before any of it is built.
 *
 * - Left: what the proposal changes (files, staged or not) and its
 *   checkpoints -- every staging is a commit, so every one is somewhere to go
 *   back to.
 * - Middle: the proposal's address in a frame, or the diff of a file.
 * - Right: the assistant, whose file tools act on this proposal.
 * - Top: the three checks a change goes through -- typecheck, build, render --
 *   and where the build runs (this tab, or a builder window on Safari).
 */

export type DesignCheck =
  | { state: "idle" }
  | { state: "running"; progress?: number }
  | { state: "passed"; detail?: string }
  | { state: "failed"; message: string };

export type DesignBuilder =
  /** Chrome and Firefox: the bundler runs in this tab. */
  | { kind: "in-tab" }
  /** Safari: the bundler needs a cross-origin isolated window of its own. */
  | { kind: "window"; connected: boolean };

export type DesignFileChange = "added" | "modified" | "deleted";

export type DesignFile = {
  path: string;
  change: DesignFileChange;
  /** Written by the assistant and not yet staged: only in this tab. */
  unstaged?: boolean;
};

export type DesignCheckpoint = {
  id: string;
  message: string;
  ago: string;
  /** Whether the build of this checkpoint rendered. */
  rendered: boolean | null;
  current?: boolean;
};

export type DesignDiffLine = {
  kind: "context" | "added" | "removed";
  text: string;
};

export type DesignPreview =
  | { state: "live" }
  /** A build is running; the frame still shows the last one. */
  | { state: "building"; progress: number }
  /** The last build does not render. The address shows the error page. */
  | {
      state: "broken";
      message: string;
      details: string;
      lastWorking: DesignCheckpoint;
    };

export type DesignDevice = "desktop" | "tablet" | "mobile";
export type DesignView = "preview" | "changes";

export type DesignTabProps = {
  proposal: { displayName: string; address: string };
  route: string;
  files: DesignFile[];
  checkpoints: DesignCheckpoint[];
  checks: {
    typecheck: DesignCheck;
    build: DesignCheck;
    render: DesignCheck;
  };
  builder: DesignBuilder;
  preview: DesignPreview;
  /** What the frame shows: the proposal's page at `route`. */
  site: ReactNode;
  /** The diff shown under Changes, for `selectedFile`. */
  diff: DesignDiffLine[];
  selectedFile: string;
  messages: ChatMessage[];
  initialView?: DesignView;
  initialDevice?: DesignDevice;
};

const VIEWS: DesignView[] = ["preview", "changes"];

const DEVICE_WIDTHS: Record<DesignDevice, number | null> = {
  desktop: null,
  tablet: 820,
  mobile: 390,
};

export function DesignTabMock(props: DesignTabProps) {
  const [view, setView] = useState<DesignView>(props.initialView ?? "preview");
  const [device, setDevice] = useState<DesignDevice>(
    props.initialDevice ?? "desktop",
  );
  const [selectedFile, setSelectedFile] = useState(props.selectedFile);
  return (
    <div className="flex h-svh flex-col bg-bg-primary text-fg-primary">
      <DesignTopBar
        proposal={props.proposal}
        checks={props.checks}
        builder={props.builder}
        broken={props.preview.state === "broken"}
      />
      {props.builder.kind === "window" && !props.builder.connected && (
        <BuilderWindowBanner />
      )}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border-primary bg-bg-secondary">
          <ChangedFiles
            files={props.files}
            selected={view === "changes" ? selectedFile : null}
            onSelect={(path) => {
              setSelectedFile(path);
              setView("changes");
            }}
          />
          <Checkpoints checkpoints={props.checkpoints} />
          <button
            type="button"
            className="mt-auto flex items-center gap-2 border-t border-border-primary px-4 py-3 text-left text-xs text-fg-secondary hover:bg-bg-secondary-hover"
          >
            <FolderTree size={14} />
            All project files
            <ChevronRight size={14} className="ml-auto" />
          </button>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-bg-canvas">
          <PreviewToolbar
            route={props.route}
            address={props.proposal.address}
            view={view}
            onView={setView}
            device={device}
            onDevice={setDevice}
            changes={props.files.length}
          />
          {view === "preview" ? (
            <PreviewArea
              preview={props.preview}
              device={device}
              site={props.site}
            />
          ) : (
            <DiffArea
              path={selectedFile}
              change={
                props.files.find((file) => file.path === selectedFile)
                  ?.change ?? "modified"
              }
              lines={props.diff}
            />
          )}
        </main>
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-border-primary">
          <AIChat
            className="h-full"
            initialMessages={props.messages}
            isConnected
            authError={false}
            mode="http"
            suggestions={[
              "Add a testimonials section to the front page",
              "Make the header sticky",
              "Use the brand colour for links",
            ]}
            onSendMessage={() => true}
          />
        </aside>
      </div>
    </div>
  );
}

function DesignTopBar({
  proposal,
  checks,
  builder,
  broken,
}: {
  proposal: DesignTabProps["proposal"];
  checks: DesignTabProps["checks"];
  builder: DesignBuilder;
  broken: boolean;
}) {
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
        <CheckChip label="Types" check={checks.typecheck} />
        <ChevronRight size={12} className="text-fg-tertiary" />
        <CheckChip label="Build" check={checks.build} />
        <ChevronRight size={12} className="text-fg-tertiary" />
        <CheckChip label="Renders" check={checks.render} />
        {builder.kind === "window" && (
          <span
            className={cn(
              "ml-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
              builder.connected
                ? "border-border-primary text-fg-secondary"
                : "border-border-warning-primary text-fg-warning-primary",
            )}
            title="Safari builds in a window of its own. This tab shows the preview."
          >
            <Hammer size={12} />
            {builder.connected ? "Builder window open" : "No builder window"}
          </span>
        )}
      </div>
      <a
        href="#"
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-fg-secondary hover:bg-bg-secondary"
      >
        Edit content in the Studio
        <ExternalLink size={12} />
      </a>
      <button
        type="button"
        disabled={broken}
        title={
          broken
            ? "The proposal's last build does not render. Fix it, or go back to a checkpoint that did, to publish."
            : undefined
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-proposal px-3 text-xs font-medium text-fg-proposal hover:bg-bg-proposal-soft disabled:border-border-primary disabled:text-fg-disabled"
      >
        <Upload size={14} />
        Publish
      </button>
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
      {check.state === "passed" && check.detail !== undefined && (
        <span className="opacity-70">{check.detail}</span>
      )}
      {check.state === "running" && check.progress !== undefined && (
        <span className="tabular-nums opacity-70">{check.progress}%</span>
      )}
    </span>
  );
}

function BuilderWindowBanner() {
  return (
    <div className="flex items-center gap-3 border-b border-border-warning-primary bg-bg-warning-primary px-4 py-2 text-xs text-fg-warning-primary">
      <Hammer size={14} className="shrink-0" />
      <span>
        Safari builds in a window of its own, so this tab can show the preview.
        Open it once and keep it open: the assistant builds there as often as it
        needs.
      </span>
      <button
        type="button"
        className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-bg-warning-secondary px-3 font-medium text-fg-warning-secondary hover:bg-bg-warning-secondary-hover"
      >
        Open the builder window
      </button>
    </div>
  );
}

/** Each a background and the text colour made for it, so both themes read. */
const CHANGE_MARK: Record<DesignFileChange, { letter: string; tone: string }> =
  {
    added: {
      letter: "A",
      tone: "bg-bg-brand-secondary text-fg-brand-secondary",
    },
    modified: {
      letter: "M",
      tone: "bg-bg-warning-secondary text-fg-warning-secondary",
    },
    deleted: { letter: "D", tone: "bg-bg-error-primary text-fg-error-primary" },
  };

function ChangeMark({ change }: { change: DesignFileChange }) {
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
  files: DesignFile[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <section className="flex flex-col border-b border-border-primary py-2">
      <h2 className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
        <FileCode2 size={12} />
        Changed from the site
        <span className="ml-auto tabular-nums">{files.length}</span>
      </h2>
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
                    className={cn(file.change === "deleted" && "line-through")}
                  >
                    {name}
                  </span>{" "}
                  <span className="text-fg-tertiary">{dir}</span>
                </span>
                {file.unstaged && (
                  <span
                    className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-bg-proposal"
                    title="Not staged yet: only in this tab"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Checkpoints({ checkpoints }: { checkpoints: DesignCheckpoint[] }) {
  return (
    <section className="flex min-h-0 flex-col py-2">
      <h2 className="flex items-center gap-2 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-tertiary">
        <History size={12} />
        Checkpoints
      </h2>
      <ol className="overflow-y-auto">
        {checkpoints.map((checkpoint) => (
          <li
            key={checkpoint.id}
            className="group flex items-start gap-2 px-4 py-1.5 text-xs"
          >
            <span className="mt-0.5 shrink-0">
              {checkpoint.rendered === true && (
                <Check size={12} className="text-fg-secondary" />
              )}
              {checkpoint.rendered === false && (
                <X size={12} className="text-fg-error-on-surface" />
              )}
              {checkpoint.rendered === null && (
                <Circle size={10} className="mt-px text-fg-tertiary" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{checkpoint.message}</span>
              <span className="text-fg-tertiary">
                {checkpoint.current ? "Now · " : ""}
                {checkpoint.ago}
              </span>
            </span>
            {!checkpoint.current && (
              <button
                type="button"
                className="hidden shrink-0 rounded px-1.5 py-0.5 text-fg-secondary hover:bg-bg-secondary-hover group-hover:inline-flex"
              >
                Go back here
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function PreviewToolbar({
  route,
  address,
  view,
  onView,
  device,
  onDevice,
  changes,
}: {
  route: string;
  address: string;
  view: DesignView;
  onView: (view: DesignView) => void;
  device: DesignDevice;
  onDevice: (device: DesignDevice) => void;
  changes: number;
}) {
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
          <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-primary bg-bg-secondary px-2 font-mono text-xs">
            <span className="truncate text-fg-tertiary">{address}</span>
            <span className="-ml-2">{route}</span>
          </div>
          <div className="flex items-center">
            {devices.map((option) => (
              <button
                key={option.device}
                type="button"
                title={option.label}
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
            className="rounded p-1.5 text-fg-secondary hover:bg-bg-secondary"
          >
            <RotateCw size={14} />
          </button>
          <a
            href="#"
            title="Open the proposal's address in a tab of its own"
            className="rounded p-1.5 text-fg-secondary hover:bg-bg-secondary"
          >
            <ExternalLink size={14} />
          </a>
        </>
      )}
    </div>
  );
}

function PreviewArea({
  preview,
  device,
  site,
}: {
  preview: DesignPreview;
  device: DesignDevice;
  site: ReactNode;
}) {
  const width = DEVICE_WIDTHS[device];
  if (preview.state === "broken") {
    return <BrokenPreview preview={preview} />;
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {preview.state === "building" && (
        <div className="flex items-center gap-3 border-b border-border-primary bg-bg-primary px-4 py-2 text-xs">
          <Spinner size={12} />
          <span>
            Building the assistant&apos;s changes. Until it is done, this is the
            last build.
          </span>
          <div className="ml-auto h-1 w-40 overflow-hidden rounded-full bg-bg-secondary">
            <div
              className="h-full bg-bg-proposal"
              style={{ width: `${preview.progress}%` }}
            />
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 justify-center overflow-hidden p-4">
        <div
          className={cn(
            "relative h-full w-full overflow-hidden rounded-lg border border-border-primary shadow-lg",
            preview.state === "building" && "opacity-60",
          )}
          style={width === null ? undefined : { maxWidth: width }}
        >
          <div className="absolute inset-0 overflow-y-auto">{site}</div>
        </div>
      </div>
    </div>
  );
}

function BrokenPreview({
  preview,
}: {
  preview: Extract<DesignPreview, { state: "broken" }>;
}) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="w-full max-w-lg rounded-lg border border-border-error-primary bg-bg-primary p-6 shadow-lg">
        <div className="mb-3 flex items-center gap-2 text-fg-error-on-surface">
          <AlertTriangle size={18} />
          <h2 className="text-base font-semibold">
            The proposal&apos;s preview does not render
          </h2>
        </div>
        <p className="mb-1 text-sm">{preview.message}</p>
        <p className="mb-5 text-sm text-fg-secondary">
          The site is not affected: it keeps serving its own build. This tab
          runs on the site&apos;s build too, so you and the assistant can keep
          working here.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bg-proposal px-3 text-xs font-medium text-fg-on-proposal hover:bg-bg-proposal-hover"
          >
            <Sparkles size={14} />
            Ask the assistant to fix it
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-primary px-3 text-xs hover:bg-bg-secondary"
          >
            <RotateCcw size={14} />
            Go back to &ldquo;{preview.lastWorking.message}&rdquo;
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowDetails((shown) => !shown)}
          className="mt-5 inline-flex items-center gap-1 text-xs text-fg-secondary hover:text-fg-primary"
        >
          <ChevronRight
            size={12}
            className={cn("transition-transform", showDetails && "rotate-90")}
          />
          Details
        </button>
        {showDetails && (
          <pre className="mt-2 max-h-48 overflow-auto rounded bg-bg-secondary p-3 font-mono text-[11px] leading-relaxed text-fg-secondary">
            {preview.details}
          </pre>
        )}
      </div>
    </div>
  );
}

function DiffArea({
  path,
  change,
  lines,
}: {
  path: string;
  change: DesignFileChange;
  lines: DesignDiffLine[];
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
        <div className="flex items-center gap-2 border-b border-border-primary px-4 py-2 font-mono text-xs">
          <ChangeMark change={change} />
          {path}
          <span className="ml-auto font-sans text-fg-tertiary">
            Compared with the site
          </span>
        </div>
        <pre className="flex-1 overflow-auto py-2 font-mono text-xs leading-5">
          {lines.map((line, index) => (
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
          ))}
        </pre>
      </div>
    </div>
  );
}
