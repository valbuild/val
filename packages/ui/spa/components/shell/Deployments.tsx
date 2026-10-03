import { useEffect, useRef, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../designSystem/tooltip";
import {
  describeIndicator,
  explainIndicator,
  indicatorOfSummary,
  indicatorPercent,
  isInFlight,
  type PublishIndicator,
} from "../../publish/publishIndicatorView";
import { seconds } from "../../publish/deployProgress";
import { ProgressBar } from "./DeployProgress";
import {
  Check,
  ChevronUp,
  CircleAlert,
  CircleHelp,
  Loader2,
  Rocket,
  X,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import {
  DeploymentProgress,
  ShellDeployment,
  ShellDeploymentPublish,
} from "./types";

/**
 * What the deploy feed adds up to right now.
 *
 * A publish is one commit that a host picks up -- WHERE THERE IS A HOST. That
 * premise is a CONNECTED project's, and it is what the whole of this file was
 * written against: a commit lands in a repository, Vercel or whoever notices,
 * and `building` really does become `live` because something outside the
 * browser moves it.
 *
 * A MANAGED project has no repository and no host watching one. Its publish
 * is a job: built in a Studio tab, then verified and SEALED by content, which
 * records the commit only once its build is live (valbuild/home,
 * docs/app-mode.md, "Publishing is a queued job"). So a managed commit is
 * never on its way out -- there is nothing to show as `building`, and a row
 * the site does not serve is one a later publish superseded. The wait before
 * the seal is this tab's own publish, `publishing`, and has no row.
 */
export type DeploymentSummary =
  | { state: "building"; count: number }
  /** This tab is publishing one of them right now: the percentage is the summary. */
  | { state: "publishing"; percent: number }
  | { state: "failed" }
  /**
   * The newest publish was last reported as building, over an hour ago. Not a
   * phase either: nothing is known to be happening, so nothing spins.
   */
  | { state: "unknown" }
  | { state: "live" }
  | { state: "none" };

/**
 * @param studioIsDeployer Whether this project is MANAGED -- a commit is
 * recorded once it is live, so no publish is ever merely on its way. Defaults to false,
 * which is the connected story, and that default is load-bearing: a server that
 * does not report a source mode is not evidence that a project has no
 * repository, and guessing managed would take the deploy feed away from every
 * project running against an older one. See `sourceMode` in `ApiRoutes`.
 */
export function summarizeDeployments(
  deployments: ShellDeployment[],
  studioIsDeployer = false,
): DeploymentSummary {
  if (deployments.length === 0) {
    return { state: "none" };
  }
  // A publish running here is what the editor is waiting on, and it outranks
  // whatever the feed says about the ones before it.
  for (const deployment of deployments) {
    if (deployment.publish?.kind === "running") {
      return { state: "publishing", percent: deployment.publish.percent };
    }
  }
  if (!studioIsDeployer) {
    const building = deployments.filter(isBuilding);
    if (building.length > 0) {
      return { state: "building", count: building.length };
    }
  }
  // Only the newest publish decides the resting state: an older failure that
  // a later publish has already fixed is history, not a warning.
  const latest = deployments[0];
  if (isFailed(latest)) {
    return { state: "failed" };
  }
  // Connected only: a managed row is never stale, for the reason above.
  if (!studioIsDeployer && isUnknown(latest)) {
    return { state: "unknown" };
  }
  return { state: "live" };
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
 * Last reported as building, over an hour ago — see `toDeployments`, which
 * is where that is decided. Never live: a commit the site serves has an answer.
 */
function isUnknown(deployment: ShellDeployment): boolean {
  return !deployment.isLive && deployment.state === "unknown";
}

/** Building, or was and stopped being reported: either way, not out yet. */
function isUnfinished(deployment: ShellDeployment): boolean {
  return isBuilding(deployment) || isUnknown(deployment);
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

/**
 * The states a publish can be rendered in.
 *
 * Exported because Recent activity shows publishes too, and a publish that
 * reads as "Building" in the status bar and as finished in the activity list is
 * two answers to one question. `isBuilding` and `isFailed` stay private: the
 * order they are asked in is part of the rule — a live commit is neither — and
 * this is that rule, once.
 */
export function deploymentProgress(
  deployment: ShellDeployment,
  studioIsDeployer = false,
): DeploymentProgress {
  // A publish running in this tab is progress whatever the host last said, and
  // whether or not that report has gone stale: the row shows a spinner and says
  // "Publishing", so this must agree. Same order as `describeDeploymentState`.
  if (!deployment.isLive && deployment.publish?.kind === "running") {
    return "building";
  }
  // Managed: recorded at the seal, so never on its way, and a report of one
  // that went stale is still one a later publish superseded. See the summary.
  if (studioIsDeployer && isUnfinished(deployment)) {
    return "settled";
  }
  if (isBuilding(deployment)) return "building";
  if (isFailed(deployment)) return "failed";
  if (isUnknown(deployment)) return "unknown";
  return "settled";
}

export type DeploymentsStatusProps = {
  deployments: ShellDeployment[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * This project is MANAGED: the Studio builds it in the tab, so no publish is
   * ever merely on its way out. See {@link summarizeDeployments}.
   */
  studioIsDeployer?: boolean;
  /**
   * What the item says: whether the site is still on its way to what was
   * published. See `publishIndicator`. Without one, the feed's own summary.
   */
  indicator?: PublishIndicator;
};

/**
 * The open/close behaviour the deploy list has: it closes on a click outside
 * or on Escape. It never opens by itself -- the status bar's indicator is what
 * says a publish is happening, and the list is where you look for the detail.
 */
function useDeploymentsList({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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

  return { containerRef };
}

/**
 * The status bar's publish indicator: spinning while the site is on its way
 * to what was published -- by anyone -- and still once it is not. Click it for
 * the list.
 *
 * The list is anchored to the item rather than portalled, so it rides the
 * floating status bar and cannot end up behind it.
 */
export function DeploymentsStatus({
  deployments,
  open,
  onOpenChange,
  studioIsDeployer = false,
  indicator: given,
}: DeploymentsStatusProps) {
  const indicator =
    given ??
    indicatorOfSummary(summarizeDeployments(deployments, studioIsDeployer));
  const { containerRef } = useDeploymentsList({ open, onOpenChange });
  const inFlight = isInFlight(indicator);
  const now = useNow(indicator.kind === "reaching");
  const label = describeIndicator(indicator, now);
  const percent = indicatorPercent(indicator, now);

  return (
    <div ref={containerRef} className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-expanded={open}
            aria-busy={inFlight}
            aria-label={`Deployments: ${label}`}
            onClick={() => onOpenChange(!open)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-1 -mx-1 hover:text-fg-primary",
              indicator.kind === "failed" && "text-fg-error-on-surface",
            )}
          >
            <IndicatorIcon indicator={indicator} />
            <span className="tabular-nums">{label}</span>
            {inFlight &&
              (percent !== null ? (
                <ProgressBar percent={percent} className="w-16" />
              ) : (
                <IndeterminateBar className="w-16" />
              ))}
            <ChevronUp
              size={12}
              className={cn(
                "text-fg-secondary-alt transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="top">
            {explainIndicator(indicator, now)}
          </TooltipContent>
        )}
      </Tooltip>
      {open && (
        <DeploymentsList
          deployments={deployments}
          studioIsDeployer={studioIsDeployer}
          onClose={() => onOpenChange(false)}
          className="absolute bottom-full right-0 mb-2 w-80"
        />
      )}
    </div>
  );
}

/** The clock, ticking each second while `ticking`: the countdown's. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

/**
 * A bar with no number behind it: a publish built where nothing reports how
 * far -- another editor's, or CI's. It says "under way", not "this far".
 */
function IndeterminateBar({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "block h-1 overflow-hidden rounded-full bg-border-primary",
        className,
      )}
    >
      <span className="block h-full w-1/3 rounded-full bg-bg-brand-secondary animate-pulse" />
    </span>
  );
}

function IndicatorIcon({ indicator }: { indicator: PublishIndicator }) {
  if (isInFlight(indicator)) {
    return <Loader2 size={13} className="animate-spin" />;
  }
  if (indicator.kind === "failed") {
    return <CircleAlert size={13} />;
  }
  if (indicator.kind === "unknown") {
    return <CircleHelp size={13} className="text-fg-secondary" />;
  }
  if (indicator.kind === "live") {
    return <Check size={13} className="text-fg-secondary-alt" />;
  }
  return <Rocket size={13} className="text-fg-secondary-alt" />;
}

/**
 * The publish feed: the last few publishes, newest first.
 *
 * Rows used to be dismissable one at a time. That was a control for a list
 * that grew — it accumulated every deployment a session had ever seen — and
 * the list is bounded now, so there is nothing to tidy: what a row would be
 * dismissed FOR is that it is old, and being old is what takes it off the end
 * of the list on its own. See `mergeCommitsAndDeployments` and
 * `DEPLOYMENT_LIMIT`.
 */
export function DeploymentsList({
  deployments,
  onClose,
  className,
  studioIsDeployer = false,
}: {
  deployments: ShellDeployment[];
  /** See {@link DeploymentsStatusProps.studioIsDeployer}. */
  studioIsDeployer?: boolean;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div
      role="dialog"
      aria-label="Deployments"
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
      <DeploymentRows
        deployments={deployments}
        studioIsDeployer={studioIsDeployer}
      />
    </div>
  );
}

/**
 * The rows on their own, so the same feed can sit in the status bar's list,
 * above the phone's bottom bar, and inline in the settings sheet.
 */
export function DeploymentRows({
  deployments,
  studioIsDeployer = false,
}: {
  deployments: ShellDeployment[];
  /** See {@link DeploymentsStatusProps.studioIsDeployer}. */
  studioIsDeployer?: boolean;
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
          studioIsDeployer={studioIsDeployer}
        />
      ))}
    </ul>
  );
}

function DeploymentRow({
  deployment,
  studioIsDeployer = false,
}: {
  deployment: ShellDeployment;
  studioIsDeployer?: boolean;
}) {
  const progress = deploymentProgress(deployment, studioIsDeployer);
  const building = progress === "building";
  const failed = progress === "failed";
  const running = deployment.publish?.kind === "running";
  const unknown = progress === "unknown" && !running;
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5 border-b border-border-float last:border-b-0">
      <span className="mt-0.5 shrink-0">
        {(building || running) && (
          <Loader2 size={13} className="animate-spin text-fg-secondary" />
        )}
        {failed && (
          <CircleAlert size={13} className="text-fg-error-on-surface" />
        )}
        {unknown && <CircleHelp size={13} className="text-fg-secondary" />}
        {!building && !running && !failed && !unknown && (
          <span className="block w-1.5 h-1.5 m-[3px] rounded-full bg-bg-brand-secondary" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-fg-primary truncate">
          {deployment.message ?? deployment.commitSha.slice(0, 7)}
        </div>
        <div className="text-[11px] text-fg-secondary-alt truncate">
          {describeDeploymentState(deployment, studioIsDeployer)}
          {deployment.author ? ` · ${deployment.author}` : ""} ·{" "}
          {deployment.timestamp}
        </div>
        {deployment.publish !== undefined && (
          <PublishBreakdown publish={deployment.publish} />
        )}
      </div>
    </li>
  );
}

/**
 * This tab's own publish of the row's commit: the percentage while it runs,
 * and how long each step took once it is done.
 */
function PublishBreakdown({ publish }: { publish: ShellDeploymentPublish }) {
  if (publish.kind === "running") {
    return (
      <div className="mt-1.5">
        <div className="flex items-center justify-between text-[11px] text-fg-secondary">
          <span>{publish.step}</span>
          <span className="tabular-nums">{publish.percent}%</span>
        </div>
        <ProgressBar percent={publish.percent} className="mt-1 w-full" />
      </div>
    );
  }
  return (
    <div className="mt-1.5 text-[11px]">
      <div className="text-fg-secondary">Live after {seconds(publish.ms)}</div>
      <ul className="mt-1 space-y-0.5 text-fg-secondary-alt">
        {publish.steps.map((step) => (
          <li key={step.label} className="flex justify-between gap-3">
            <span className="truncate">{step.label}</span>
            <span className="tabular-nums">{seconds(step.ms)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What happened to a publish, in a word or two.
 *
 * Exported for the same reason as {@link deploymentProgress}: the activity list
 * says it about the same publishes.
 */
export function describeDeploymentState(
  deployment: ShellDeployment,
  studioIsDeployer = false,
): string {
  // The site answering with this commit outranks anything the build host said
  // about it, including having said nothing at all. See `isBuilding`.
  if (deployment.isLive) {
    return "Live";
  }
  if (deployment.publish?.kind === "running") {
    return "Publishing";
  }
  /*
   * Managed: there is no build host, and a commit is recorded at its seal --
   * once its build is live. One the site does not serve is one a later
   * publish superseded, not one on its way out.
   */
  if (studioIsDeployer && isUnfinished(deployment)) {
    return "Published";
  }
  switch (deployment.state) {
    case "created":
      return "Queued";
    case "pending":
      return "Building";
    case "failure":
    case "error":
      return "Build failed";
    case "unknown":
      return "Status unknown";
    case "success":
      // A green build is not the same as a page you can load: Val watches for
      // the commit to answer from the site before saying it is live.
      return "Built";
  }
}
