import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FileText,
  GitBranch,
  Hammer,
  History,
  Monitor,
  MousePointerClick,
  Paintbrush,
  RotateCw,
  Smartphone,
  Sparkles,
  Tablet,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../designSystem/cn";
import { Spinner } from "../designSystem/spinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import type { ChangedFile, FileChange } from "../../design/changedFiles";
import type { DiffLine } from "../../design/lineDiff";

/**
 * The design tab, as it looks (valbuild/home `docs/design-tab.md`): a
 * proposal's code, changed by the assistant and previewed, in a tab of its own
 * served by the SITE's build -- so it stays up when the proposal's code does
 * not. `DesignTab` wires it; this is only what it shows.
 *
 * - Middle: the proposal's address in a frame, or a file against the site's.
 *   Anything on the page can be picked (hold the modifier, or Select), and
 *   the assistant is told which.
 * - Right: the assistant, whose code tools act on this proposal, with what
 *   was picked above it.
 * - Top: the checks a change goes through as one quiet word beside the
 *   proposal's name ("Ready", "Build failed"), with the list behind it; its
 *   history behind a button; the build, the proposal's own Studio, and
 *   Publish.
 *
 * Which files changed is not a panel of its own: it is the Changes view.
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

export type DesignCheckItem = {
  label: string;
  check: DesignCheck;
  /** What the check's last run took, step by step: a build's. */
  timings?: { step: string; ms: number }[];
};

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

/**
 * Pointing at something on the page: ANY element, picked in the frame while
 * the modifier is held (or Select is on), is mentioned to the assistant.
 * `waiting` until the frame's page answers; `off` when it cannot pick, which
 * offers to turn it on.
 */
export type DesignPicking = {
  active: boolean;
  onToggle: () => void;
  status: "live" | "waiting" | "off";
  onTurnOn: () => void;
  /** The key held to pick, as this keyboard names it: `⌥`, `Alt`. */
  modifier: string;
};

/** What was picked on the page, as the assistant is told it. */
export type DesignPicked = {
  tag: string;
  text: string;
  selector: string;
  valPath?: string;
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
  /** The site's pages, to pick the one the frame shows. */
  pages: string[];
  onReload: () => void;
  /** `null`: the frame cannot pick (nothing is framed). */
  picking: DesignPicking | null;
  /** What was picked, shown above the assistant until it is sent or cleared. */
  picked?: DesignPicked | null;
  onClearPicked?: () => void;
  /** Publish (merge) the proposal into the site; `null`: not offered. */
  onPublish: (() => void) | null;
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
    /** `Date.now()` when the running build started; `null` when none runs. */
    startedAt: number | null;
    /** `null`: nothing to build here. */
    onBuild: (() => void) | null;
    /** Stop the running build. */
    onCancel: () => void;
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
  const checkpoints =
    props.checkpoints !== null && props.checkpoints.length > 0
      ? props.checkpoints
      : null;
  return (
    <div className="flex h-svh flex-col bg-bg-primary text-fg-primary">
      <DesignTopBar {...props} checkpoints={checkpoints} />
      {props.builder.kind === "window" &&
        props.builder.blocked &&
        props.onOpenBuilder !== undefined && (
          <BuilderWindowBanner onOpen={props.onOpenBuilder} />
        )}
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col bg-bg-canvas">
          <PreviewToolbar
            route={props.route}
            onRouteChange={props.onRouteChange}
            pages={props.pages}
            onReload={props.onReload}
            address={props.proposal.address}
            previewHref={props.previewHref}
            view={view}
            onView={setView}
            device={device}
            onDevice={setDevice}
            changes={files.length}
            picking={props.picking}
          />
          {props.problem !== null && <ProblemBanner problem={props.problem} />}
          {view === "preview" ? (
            <PreviewArea
              address={props.proposal.address}
              building={props.build.building}
              progress={props.build.progress}
              startedAt={props.build.startedAt}
              onCancel={props.build.onCancel}
              device={device}
              preview={props.preview}
              picking={props.picking}
            />
          ) : shownFile === null ? (
            <Empty>
              Nothing is changed from the site yet. Ask the assistant for a
              change, and the files it writes are shown here.
            </Empty>
          ) : (
            <DiffArea
              files={files}
              file={shownFile}
              onSelect={setSelected}
              lines={props.diffOf(shownFile.path)}
            />
          )}
        </main>
        <aside className="flex w-[380px] shrink-0 flex-col border-l border-border-primary">
          {props.picked !== undefined && props.picked !== null && (
            <PickedCard picked={props.picked} onClear={props.onClearPicked} />
          )}
          <div className="flex min-h-0 flex-1 flex-col">{props.chat}</div>
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
  onPublish,
  checkpoints,
}: DesignTabViewProps & {
  checkpoints: DesignCheckpoint[] | null;
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
      <ChecksStatus checks={checks} />
      {builder.kind === "window" && (
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px]",
            builder.blocked ? "text-fg-warning-primary" : "text-fg-tertiary",
          )}
          title="This browser builds in a window of its own. This tab shows the preview."
        >
          <Hammer size={12} />
          {builder.blocked ? "No builder window" : "Builds in a window"}
        </span>
      )}
      <div className="ml-auto flex items-center gap-1">
        {checkpoints !== null && <HistoryMenu checkpoints={checkpoints} />}
        {studioUrl !== null && (
          <a
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs text-fg-secondary hover:bg-bg-secondary"
            title="Its content is edited in the proposal's own Studio"
          >
            Proposal&apos;s Studio
            <ExternalLink size={12} />
          </a>
        )}
        {build.building ? (
          <button
            type="button"
            onClick={build.onCancel}
            title="Stop this build. The preview keeps the last one that worked."
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-primary px-3 text-xs font-medium text-fg-primary hover:bg-bg-secondary"
          >
            <Spinner size={14} />
            Cancel build
          </button>
        ) : (
          build.onBuild !== null &&
          build.required && (
            <button
              type="button"
              onClick={build.onBuild}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-primary px-3 text-xs font-medium text-fg-primary hover:bg-bg-secondary"
            >
              <Hammer size={14} />
              Build
            </button>
          )
        )}
        {onPublish !== null && (
          <button
            type="button"
            onClick={onPublish}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bg-proposal px-3 text-xs font-medium text-fg-on-proposal hover:bg-bg-proposal-hover"
          >
            <Upload size={14} />
            Publish
          </button>
        )}
      </div>
    </header>
  );
}

type ChecksTone = "passed" | "running" | "failed" | "idle";

/** All the checks as one: the first that failed, else the one running. */
function summarise(checks: DesignCheckItem[]): {
  tone: ChecksTone;
  label: string;
} {
  const failed = checks.find((item) => item.check.state === "failed");
  if (failed !== undefined)
    return { tone: "failed", label: `${failed.label} failed` };
  const running = checks.find((item) => item.check.state === "running");
  if (running !== undefined && running.check.state === "running") {
    const percent = running.check.percent;
    return {
      tone: "running",
      label:
        percent !== undefined && percent !== null
          ? `${running.label} · ${percent}%`
          : `${running.label}…`,
    };
  }
  const idle = checks.find((item) => item.check.state === "idle");
  if (idle !== undefined && idle.check.state === "idle") {
    // Named: alone beside the proposal's name, "needed" says nothing.
    return {
      tone: "idle",
      label: `${idle.label}: ${idle.check.detail ?? "not checked"}`,
    };
  }
  return { tone: "passed", label: "Ready" };
}

function ToneDot({ tone }: { tone: ChecksTone }) {
  if (tone === "running") return <Spinner size={10} />;
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        tone === "passed" && "bg-bg-brand-secondary",
        tone === "failed" && "bg-bg-error-primary",
        tone === "idle" && "bg-fg-disabled",
      )}
    />
  );
}

/** Each check, with what it said: what the quiet forms open onto. */
function ChecksList({ checks }: { checks: DesignCheckItem[] }) {
  return (
    <ul className="flex flex-col gap-2 text-xs">
      {checks.map((item) => (
        <li key={item.label} className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            {item.check.state === "passed" && (
              <Check size={12} className="text-fg-secondary" />
            )}
            {item.check.state === "failed" && (
              <X size={12} className="text-fg-error-on-surface" />
            )}
            {item.check.state === "running" && <Spinner size={12} />}
            {item.check.state === "idle" && (
              <Circle size={10} className="text-fg-tertiary" />
            )}
          </span>
          <span className="min-w-0">
            <span className="font-medium">{item.label}</span>
            {item.check.state === "failed" ? (
              <span className="mt-0.5 block text-fg-secondary">
                {item.check.message}
              </span>
            ) : item.check.state === "running" ? (
              <span className="text-fg-tertiary"> · running</span>
            ) : item.check.detail !== undefined ? (
              <span className="text-fg-tertiary"> · {item.check.detail}</span>
            ) : null}
            {item.timings !== undefined && item.timings.length > 0 && (
              <Timings timings={item.timings} />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** How long each step took, longest marked: where a slow build's time went. */
function Timings({ timings }: { timings: { step: string; ms: number }[] }) {
  const longest = Math.max(...timings.map((t) => t.ms));
  return (
    <table className="mt-1 w-full text-[11px] text-fg-tertiary">
      <tbody>
        {timings.map((timing, index) => (
          <tr
            key={`${timing.step}-${index}`}
            className={cn(timing.ms === longest && "text-fg-secondary")}
          >
            <td className="pr-2">{timing.step}</td>
            <td className="text-right tabular-nums">
              {formatSeconds(timing.ms)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** `0.4s`, `12s`, `1:05`. */
function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Time since `since`, ticking every second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="tabular-nums text-fg-tertiary">
      {formatSeconds(Math.max(0, now - since))}
    </span>
  );
}

/** The checks, quietly: a dot and one word beside the name; the rest on a click. */
function ChecksStatus({ checks }: { checks: DesignCheckItem[] }) {
  const summary = summarise(checks);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-bg-secondary",
            summary.tone === "failed"
              ? "text-fg-error-on-surface"
              : "text-fg-tertiary",
          )}
        >
          <ToneDot tone={summary.tone} />
          {summary.label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <ChecksList checks={checks} />
      </PopoverContent>
    </Popover>
  );
}

function HistoryMenu({ checkpoints }: { checkpoints: DesignCheckpoint[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="History"
          aria-label="History"
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-secondary hover:bg-bg-secondary"
        >
          <History size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 py-1">
        <Checkpoints checkpoints={checkpoints} />
      </PopoverContent>
    </Popover>
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
  pages,
  onReload,
  address,
  previewHref,
  view,
  onView,
  device,
  onDevice,
  changes,
  picking,
}: {
  route: string;
  onRouteChange: (route: string) => void;
  pages: string[];
  onReload: () => void;
  address: string | null;
  previewHref: string | null;
  view: DesignView;
  onView: (view: DesignView) => void;
  device: DesignDevice;
  onDevice: (device: DesignDevice) => void;
  changes: number;
  picking: DesignPicking | null;
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
          {pages.length > 0 && (
            <PagesMenu pages={pages} current={route} onPick={onRouteChange} />
          )}
          {picking !== null && picking.status !== "off" && (
            <button
              type="button"
              aria-pressed={picking.active}
              disabled={picking.status !== "live"}
              onClick={picking.onToggle}
              title={`Select something on the page, and the assistant is told which. Or hold ${picking.modifier} and click.`}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs",
                picking.active
                  ? "bg-bg-proposal text-fg-on-proposal"
                  : "text-fg-secondary hover:bg-bg-secondary",
                "disabled:text-fg-disabled",
              )}
            >
              <MousePointerClick size={14} />
              Select
            </button>
          )}
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

/** The site's pages, to show one in the frame. */
function PagesMenu({
  pages,
  current,
  onPick,
}: {
  pages: string[];
  current: string;
  onPick: (route: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-border-primary px-2 text-xs text-fg-secondary hover:bg-bg-secondary"
      >
        <FileText size={12} />
        Pages
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-full mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-border-float bg-bg-float py-1 shadow-lg"
        >
          {pages.map((page) => (
            <button
              key={page}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onPick(page);
              }}
              className={cn(
                "block w-full truncate px-3 py-1.5 text-left font-mono text-xs hover:bg-bg-float-raised",
                page === current && "text-fg-proposal",
              )}
            >
              {page}
            </button>
          ))}
          <p className="border-t border-border-float px-3 py-1.5 text-[11px] text-fg-tertiary">
            The site&apos;s pages. A page the proposal adds is reached by typing
            its path.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Over the page, small: how to pick, while Select is off; what to do, while it
 * is on. When the frame cannot pick, it offers to turn that on.
 */
function PickingHint({ picking }: { picking: DesignPicking }) {
  if (picking.status === "waiting") return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-bg-float/90 px-3 py-1 text-[11px] text-fg-secondary shadow-sm">
      {picking.status === "off" ? (
        <>
          <span>Selecting needs preview mode on this page</span>
          <button
            type="button"
            onClick={picking.onTurnOn}
            className="pointer-events-auto font-medium text-fg-proposal hover:underline"
          >
            Turn it on
          </button>
        </>
      ) : picking.active ? (
        <span>Click anything on the page · Esc to stop</span>
      ) : (
        <span>
          Hold{" "}
          <kbd className="rounded border border-border-primary px-1 font-sans">
            {picking.modifier}
          </kbd>{" "}
          and click anything to show it to the assistant
        </span>
      )}
    </div>
  );
}

/** What was picked, above the assistant: it goes with the next message. */
function PickedCard({
  picked,
  onClear,
}: {
  picked: DesignPicked;
  onClear?: () => void;
}) {
  return (
    <div className="m-3 mb-0 flex items-start gap-2 rounded-lg border border-border-proposal bg-bg-proposal-soft px-3 py-2 text-xs">
      <MousePointerClick
        size={14}
        className="mt-0.5 shrink-0 text-fg-proposal"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5">
          <code className="rounded bg-bg-primary px-1 font-mono text-[11px]">
            &lt;{picked.tag}&gt;
          </code>
          <span className="truncate font-medium">
            {picked.text !== "" ? picked.text : "No text"}
          </span>
        </p>
        <p
          className="mt-0.5 truncate font-mono text-[10px] text-fg-tertiary"
          title={picked.selector}
        >
          {picked.selector}
        </p>
      </div>
      {onClear !== undefined && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear what was selected"
          className="shrink-0 rounded p-0.5 text-fg-secondary hover:bg-bg-primary"
        >
          <X size={12} />
        </button>
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
  startedAt,
  onCancel,
  device,
  preview,
  picking,
}: {
  address: string | null;
  building: boolean;
  progress: { label: string; percent: number | null } | null;
  startedAt: number | null;
  onCancel: () => void;
  device: DesignDevice;
  preview: ReactNode;
  picking: DesignPicking | null;
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
          {startedAt !== null && <Elapsed since={startedAt} />}
          <span className="ml-auto flex items-center gap-3">
            {progress?.percent !== null && progress?.percent !== undefined && (
              <span className="h-1 w-40 overflow-hidden rounded-full bg-bg-secondary">
                <span
                  className="block h-full bg-bg-proposal"
                  style={{ width: `${progress.percent}%` }}
                />
              </span>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-1.5 py-0.5 font-medium text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary"
            >
              Cancel
            </button>
          </span>
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
          {picking !== null && <PickingHint picking={picking} />}
        </div>
      </div>
    </div>
  );
}

const CHANGE_MARK: Record<FileChange, { letter: string; tone: string }> = {
  added: { letter: "A", tone: "text-fg-brand-primary" },
  modified: { letter: "M", tone: "text-fg-warning-primary" },
  deleted: { letter: "D", tone: "text-fg-error-on-surface" },
};

function ChangeMark({ change }: { change: FileChange }) {
  const mark = CHANGE_MARK[change];
  return (
    <span
      title={change}
      className={cn(
        "w-3 shrink-0 font-mono text-[10px] font-semibold",
        mark.tone,
      )}
    >
      {mark.letter}
    </span>
  );
}

/**
 * A file against the site's copy. Which files changed is this view's own
 * list, on its left, rather than a panel beside the preview.
 */
function DiffArea({
  files,
  file,
  onSelect,
  lines,
}: {
  files: ChangedFile[];
  file: ChangedFile;
  onSelect: (path: string) => void;
  lines: DiffLine[];
}) {
  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4">
      <ul className="w-56 shrink-0 overflow-y-auto text-xs">
        {files.map((item) => {
          const slash = item.path.lastIndexOf("/");
          return (
            <li key={item.path}>
              <button
                type="button"
                onClick={() => onSelect(item.path)}
                title={item.path}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-bg-secondary",
                  item.path === file.path && "bg-bg-secondary font-medium",
                )}
              >
                <ChangeMark change={item.change} />
                <span
                  className={cn(
                    "min-w-0 truncate",
                    item.change === "deleted" && "line-through",
                  )}
                >
                  {item.path.slice(slash + 1)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-primary bg-bg-primary">
        <div className="flex items-center gap-2 border-b border-border-primary px-4 py-2 font-mono text-xs">
          <ChangeMark change={file.change} />
          {file.path}
          {!file.staged && (
            <span
              className="font-sans text-fg-tertiary"
              title="Changed by a save of its content, not staged as code"
            >
              · content
            </span>
          )}
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
