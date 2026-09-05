import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronUp,
  CircleAlert,
  Loader2,
  Rocket,
  X,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import { ShellDeployment } from "./types";

/**
 * What the deploy feed adds up to right now.
 *
 * A publish is one commit that a host picks up, so the bar only ever needs to
 * say one thing: something is on its way out, the last one failed, or the last
 * one landed. The list behind it is where the individual publishes live.
 */
export type DeploymentSummary =
  | { state: "building"; count: number }
  | { state: "failed" }
  | { state: "live" }
  | { state: "none" };

export function summarizeDeployments(
  deployments: ShellDeployment[],
): DeploymentSummary {
  if (deployments.length === 0) {
    return { state: "none" };
  }
  const building = deployments.filter(isBuilding);
  if (building.length > 0) {
    return { state: "building", count: building.length };
  }
  // Only the newest publish decides the resting state: an older failure that
  // a later publish has already fixed is history, not a warning.
  const latest = deployments[0];
  if (isFailed(latest)) {
    return { state: "failed" };
  }
  return { state: "live" };
}

/**
 * How recently a publish must have gone live to be worth popping the list for.
 */
export const DEPLOYMENT_NEWS_WINDOW_MS = 10 * 60 * 1000;

/**
 * Whether a publish showing up in the feed is news, or history.
 *
 * The list opens itself for a commit it has not seen before, which is right
 * for a publish that just happened and wrong for one that finished long ago -
 * and the two are indistinguishable from "not in the previous feed". A commit
 * arrives that way whenever the feed is first fetched in a new tab, when a
 * colleague published while this tab was closed, or when the deploy feed
 * simply comes back in a different order.
 *
 * A publish still on its way out is always news: it is going to change again,
 * and its result is what the list exists to show. One already serving the site
 * is news only while it is fresh - past that, someone opening Val is not
 * looking at their own publish, so the list stays shut and the status bar says
 * "Deployed" like it would for anything else.
 */
export function isDeploymentNews(
  deployment: ShellDeployment,
  now: number,
): boolean {
  if (!deployment.isLive) {
    return true;
  }
  const updatedAt = new Date(deployment.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) {
    // An unreadable timestamp is not grounds for hiding a publish.
    return true;
  }
  return now - updatedAt <= DEPLOYMENT_NEWS_WINDOW_MS;
}

/**
 * Whether a publish is still on its way out.
 *
 * `isLive` — Val has seen the site answer with this commit — settles it on its
 * own, whatever the host last said about the build. It has to: the build state
 * comes from somewhere else entirely (GitHub deployment events, relayed by the
 * content service), and when that channel says nothing a publish sits at
 * `created` forever. The site serving the commit is the one answer Val can get
 * for itself, and it is the stronger one anyway — a page you can load is what
 * "deployed" meant in the first place.
 */
function isBuilding(deployment: ShellDeployment): boolean {
  if (deployment.isLive) {
    return false;
  }
  return deployment.state === "created" || deployment.state === "pending";
}

/**
 * Whether a publish failed to go out.
 *
 * A commit the site is serving did go out, so a failure reported for it is
 * about some other build of the same commit — a preview environment, a retried
 * job — and not something to warn about.
 */
function isFailed(deployment: ShellDeployment): boolean {
  if (deployment.isLive) {
    return false;
  }
  return deployment.state === "failure" || deployment.state === "error";
}

export type DeploymentsStatusProps = {
  deployments: ShellDeployment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: (commitSha: string) => void;
  /**
   * Close the list on its own once every publish is live.
   *
   * Only set for a list that opened itself: one you opened deliberately
   * should not disappear while you are looking at it.
   */
  autoClose?: boolean;
};

/** How long a finished publish stays on screen before the list closes. */
export const DEPLOYMENTS_AUTO_CLOSE_MS = 5000;

/**
 * The open/close behaviour the deploy list has wherever it is shown: it closes
 * itself once everything has landed, it closes on a click outside or on
 * Escape, and it holds off while the pointer is on it.
 *
 * A hook rather than part of the status bar item, because the phone has no
 * status bar to hang it on and needs the same list with the same behaviour -
 * see `MobileDeployments`.
 */
function useDeploymentsList({
  deployments,
  open,
  onOpenChange,
  autoClose,
}: {
  deployments: ShellDeployment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoClose: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReading, setIsReading] = useState(false);

  // The list has said what it opened to say once everything is live, so it
  // gets out of the way — unless the pointer is on it, which is the one
  // signal we have that someone is still reading.
  const shouldAutoClose =
    open &&
    autoClose &&
    !isReading &&
    summarizeDeployments(deployments).state === "live";
  useEffect(() => {
    if (!shouldAutoClose) {
      return;
    }
    const timeout = setTimeout(
      () => onOpenChange(false),
      DEPLOYMENTS_AUTO_CLOSE_MS,
    );
    return () => clearTimeout(timeout);
  }, [shouldAutoClose, onOpenChange]);

  // Clicking anywhere else closes the list. Publishing is not modal, so this
  // must not trap the pointer the way a dialog would.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        containerRef.current &&
        !containerRef.current.contains(target)
      ) {
        onOpenChange(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    // The shell lives in a shadow root, so listen on the node that actually
    // sees the event rather than assuming `document`.
    const root = containerRef.current?.getRootNode();
    const listenerTarget: Node & EventTarget = root ?? document;
    listenerTarget.addEventListener(
      "pointerdown",
      onPointerDown as EventListener,
    );
    document.addEventListener("keydown", onKeyDown);
    return () => {
      listenerTarget.removeEventListener(
        "pointerdown",
        onPointerDown as EventListener,
      );
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return { containerRef, setIsReading };
}

/**
 * The status bar's deploy item: a summary you can click to open the list.
 *
 * The list is anchored to the item rather than portalled, so it rides the
 * floating status bar and cannot end up behind it.
 */
export function DeploymentsStatus({
  deployments,
  open,
  onOpenChange,
  onDismiss,
  autoClose = false,
}: DeploymentsStatusProps) {
  const summary = summarizeDeployments(deployments);
  const { containerRef, setIsReading } = useDeploymentsList({
    deployments,
    open,
    onOpenChange,
    autoClose,
  });

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Deployments: ${describeSummary(summary)}`}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded px-1 -mx-1 hover:text-fg-primary",
          summary.state === "failed" && "text-fg-error-on-surface",
        )}
      >
        <SummaryIcon summary={summary} />
        {describeSummary(summary)}
        <ChevronUp
          size={12}
          className={cn(
            "text-fg-secondary-alt transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <DeploymentsList
          deployments={deployments}
          onDismiss={onDismiss}
          onClose={() => onOpenChange(false)}
          onReadingChange={setIsReading}
          className="absolute bottom-full right-0 mb-2 w-80"
        />
      )}
    </div>
  );
}

function describeSummary(summary: DeploymentSummary): string {
  switch (summary.state) {
    case "building":
      return summary.count > 1
        ? `Building ${summary.count} publishes`
        : "Building";
    case "failed":
      return "Build failed";
    case "live":
      return "Deployed";
    case "none":
      return "No deploys";
  }
}

function SummaryIcon({ summary }: { summary: DeploymentSummary }) {
  if (summary.state === "building") {
    return <Loader2 size={13} className="animate-spin" />;
  }
  if (summary.state === "failed") {
    return <CircleAlert size={13} />;
  }
  if (summary.state === "live") {
    return <Check size={13} className="text-fg-secondary-alt" />;
  }
  return <Rocket size={13} className="text-fg-secondary-alt" />;
}

/**
 * The deploy feed on a phone, above the bottom bar.
 *
 * The phone has no status bar - `MobileBottomBar` takes that row - so the
 * deploy feed lived only inside the settings sheet, behind the Info button.
 * Publishing from a phone therefore said nothing at all: the button went back
 * to "Publish" and that was the whole of the feedback, with no way to tell a
 * push that had landed from one that had never gone out.
 *
 * So the list itself comes to the phone. It is the same list, with the same
 * rows and the same auto-close, sitting where a toast would - which is what it
 * is being used as here. The copy in the settings sheet stays: that is where
 * you go to look something up, this is what tells you it happened.
 */
export function MobileDeployments({
  deployments,
  open,
  onOpenChange,
  onDismiss,
  autoClose = false,
}: DeploymentsStatusProps) {
  const { containerRef, setIsReading } = useDeploymentsList({
    deployments,
    open,
    onOpenChange,
    autoClose,
  });
  if (!open) {
    return null;
  }
  return (
    <div
      ref={containerRef}
      // Clear of the bottom bar, which is `py-2.5` around a 36px row.
      className="absolute z-full inset-x-3 bottom-[3.75rem]"
    >
      <DeploymentsList
        deployments={deployments}
        onDismiss={onDismiss}
        onClose={() => onOpenChange(false)}
        onReadingChange={setIsReading}
      />
    </div>
  );
}

/**
 * The publish feed, newest first.
 *
 * Rows are dismissable one at a time so a finished publish can be cleared
 * without losing sight of one that is still building.
 */
export function DeploymentsList({
  deployments,
  onDismiss,
  onClose,
  onReadingChange,
  className,
}: {
  deployments: ShellDeployment[];
  onDismiss: (commitSha: string) => void;
  onClose: () => void;
  /** True while the pointer is on the list, which holds off auto-close. */
  onReadingChange?: (isReading: boolean) => void;
  className?: string;
}) {
  return (
    <div
      role="dialog"
      aria-label="Deployments"
      onPointerEnter={() => onReadingChange?.(true)}
      onPointerLeave={() => onReadingChange?.(false)}
      className={cn(
        "rounded-lg overflow-hidden",
        "bg-bg-float border border-border-float shadow-xl",
        className,
      )}
    >
      <div className="flex items-center justify-between px-3 h-9 border-b border-border-float">
        <span className="text-xs font-medium text-fg-primary">Deployments</span>
        <button
          type="button"
          aria-label="Close deployments"
          onClick={onClose}
          className="text-fg-secondary-alt hover:text-fg-primary"
        >
          <X size={14} />
        </button>
      </div>
      <DeploymentRows deployments={deployments} onDismiss={onDismiss} />
    </div>
  );
}

/**
 * The rows on their own, so the same feed can sit in the status bar's list,
 * above the phone's bottom bar, and inline in the settings sheet.
 */
export function DeploymentRows({
  deployments,
  onDismiss,
}: {
  deployments: ShellDeployment[];
  onDismiss: (commitSha: string) => void;
}) {
  if (deployments.length === 0) {
    return (
      <p className="px-3 py-4 text-xs text-fg-secondary-alt">
        Nothing published yet. Publishing sends your changes to the site and the
        build shows up here.
      </p>
    );
  }
  return (
    <ul className="max-h-64 overflow-y-auto scrollbar-slim">
      {deployments.map((deployment) => (
        <DeploymentRow
          key={deployment.commitSha}
          deployment={deployment}
          onDismiss={() => onDismiss(deployment.commitSha)}
        />
      ))}
    </ul>
  );
}

function DeploymentRow({
  deployment,
  onDismiss,
}: {
  deployment: ShellDeployment;
  onDismiss: () => void;
}) {
  const building = isBuilding(deployment);
  const failed = isFailed(deployment);
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border-float last:border-b-0">
      <span className="mt-0.5 shrink-0">
        {building && (
          <Loader2 size={13} className="animate-spin text-fg-secondary" />
        )}
        {failed && (
          <CircleAlert size={13} className="text-fg-error-on-surface" />
        )}
        {!building && !failed && (
          <span className="block w-1.5 h-1.5 m-[3px] rounded-full bg-bg-brand-secondary" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-fg-primary truncate">
          {deployment.message ?? deployment.commitSha.slice(0, 7)}
        </div>
        <div className="text-[11px] text-fg-secondary-alt truncate">
          {describeState(deployment)}
          {deployment.author ? ` · ${deployment.author}` : ""} ·{" "}
          {deployment.timestamp}
        </div>
      </div>
      {!building && (
        <button
          type="button"
          aria-label="Dismiss deployment"
          onClick={onDismiss}
          className="mt-0.5 shrink-0 text-fg-secondary-alt hover:text-fg-primary"
        >
          <X size={13} />
        </button>
      )}
    </li>
  );
}

function describeState(deployment: ShellDeployment): string {
  // The site answering with this commit outranks anything the build host said
  // about it, including having said nothing at all. See `isBuilding`.
  if (deployment.isLive) {
    return "Live";
  }
  switch (deployment.state) {
    case "created":
      return "Queued";
    case "pending":
      return "Building";
    case "failure":
    case "error":
      return "Build failed";
    case "success":
      // A green build is not the same as a page you can load: Val watches for
      // the commit to answer from the site before saying it is live.
      return "Built";
  }
}
