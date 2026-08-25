import { useEffect, useRef } from "react";
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
  const building = deployments.filter(
    (deployment) =>
      deployment.state === "created" || deployment.state === "pending",
  );
  if (building.length > 0) {
    return { state: "building", count: building.length };
  }
  // Only the newest publish decides the resting state: an older failure that
  // a later publish has already fixed is history, not a warning.
  const latest = deployments[0];
  if (latest.state === "failure" || latest.state === "error") {
    return { state: "failed" };
  }
  return { state: "live" };
}

export type DeploymentsStatusProps = {
  deployments: ShellDeployment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: (commitSha: string) => void;
};

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
}: DeploymentsStatusProps) {
  const summary = summarizeDeployments(deployments);
  const containerRef = useRef<HTMLDivElement>(null);

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
 * The publish feed, newest first.
 *
 * Rows are dismissable one at a time so a finished publish can be cleared
 * without losing sight of one that is still building.
 */
export function DeploymentsList({
  deployments,
  onDismiss,
  onClose,
}: {
  deployments: ShellDeployment[];
  onDismiss: (commitSha: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Deployments"
      className={cn(
        "absolute bottom-full right-0 mb-2 w-80 rounded-lg overflow-hidden",
        "bg-bg-float border border-border-float shadow-xl",
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
 * The rows on their own, so the same feed can sit in the status bar's list and
 * inline in the settings sheet, which is where it lives on mobile.
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
    <ul className="max-h-64 overflow-y-auto">
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
  const isBuilding =
    deployment.state === "created" || deployment.state === "pending";
  const isFailed =
    deployment.state === "failure" || deployment.state === "error";
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border-float last:border-b-0">
      <span className="mt-0.5 shrink-0">
        {isBuilding && (
          <Loader2 size={13} className="animate-spin text-fg-secondary" />
        )}
        {isFailed && (
          <CircleAlert size={13} className="text-fg-error-on-surface" />
        )}
        {!isBuilding && !isFailed && (
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
      {!isBuilding && (
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
      return deployment.isLive ? "Live" : "Built";
  }
}
