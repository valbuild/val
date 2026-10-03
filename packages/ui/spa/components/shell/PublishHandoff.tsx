import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  RotateCw,
  X,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import { OverlayCard } from "./OverlayMenu";
import { seconds } from "../../publish/deployProgress";

/**
 * Publishing from the overlay, which cannot build.
 *
 * The bundler needs a cross-origin isolated document, and only the Studio is
 * one: isolating the customer's own pages would break their embeds. So a
 * Publish on the site requests a publish job and hands its build to a Studio tab, which
 * reports back. These are the two ends of that: the card on the site, and the
 * page in the tab.
 */

export type HandoffState =
  /** The tab is open and loading the Studio. */
  | { kind: "opening" }
  /** The tab is building or publishing; `step` is `describeDeployPhase`. */
  | { kind: "running"; step: string; elapsedMs: number }
  /**
   * The tab built it and handed it to the content service, which checks the
   * site renders and puts it live -- the tab has closed. Followed by this
   * page's own publish tracker from here.
   */
  | { kind: "checking" }
  /** `followed`: learned by this page itself, after the tab handed it on. */
  | { kind: "live"; ms: number; followed?: boolean }
  /** The browser refused to open the tab. The changes are kept. */
  | { kind: "blocked" }
  /** `message` is the sentence; `details` the technical text, folded away. */
  | { kind: "failed"; message: string; details?: string; followed?: boolean };

/**
 * Is the card the only thing that will say this? Not once the tab has handed
 * the job on, where a page with its own publish surfaces (the Studio's toast
 * and deploy list) already follows it -- a card saying "Live" beside them
 * said it twice. The overlay has none, and shows the card throughout.
 */
export function handoffCardIsNews(state: HandoffState): boolean {
  if (state.kind === "checking") return false;
  if (state.kind === "live" || state.kind === "failed")
    return state.followed !== true;
  return true;
}

/**
 * The card in the Studio, where the status bar's indicator already follows
 * the build -- the tab's step while it runs, and the edges after Live. So it
 * is only for what needs a hand: a blocked tab, or one that failed.
 */
export function handoffCardInStudio(state: HandoffState): boolean {
  return (
    handoffCardIsNews(state) &&
    state.kind !== "opening" &&
    state.kind !== "running"
  );
}

export function PublishHandoffCard({
  state,
  onShowTab,
  onReload,
  onOpenStudio,
  onDismiss,
  className,
}: {
  state: HandoffState;
  onShowTab?: () => void;
  onReload?: () => void;
  onOpenStudio?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <OverlayCard className={cn("w-[320px] text-xs", className)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0">
          <HandoffIcon state={state} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg-primary">
            {handoffTitle(state)}
          </p>
          <p className="mt-0.5 text-fg-secondary">{handoffBody(state)}</p>
          {state.kind === "failed" && state.details && (
            <FailureDetails details={state.details} />
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {(state.kind === "opening" || state.kind === "running") &&
              onShowTab && (
                <CardButton
                  onClick={onShowTab}
                  icon={<ExternalLink size={12} />}
                >
                  Show the tab
                </CardButton>
              )}
            {state.kind === "live" && onReload && (
              <CardButton
                onClick={onReload}
                primary
                icon={<RotateCw size={12} />}
              >
                Reload to see it
              </CardButton>
            )}
            {(state.kind === "blocked" || state.kind === "failed") &&
              onOpenStudio && (
                <CardButton
                  onClick={onOpenStudio}
                  primary
                  icon={<ExternalLink size={12} />}
                >
                  {state.kind === "blocked"
                    ? "Open the Studio to publish"
                    : "Open the Studio"}
                </CardButton>
              )}
          </div>
        </div>
        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className="shrink-0 text-fg-secondary-alt hover:text-fg-primary"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </OverlayCard>
  );
}

function HandoffIcon({ state }: { state: HandoffState }) {
  switch (state.kind) {
    case "opening":
    case "running":
    case "checking":
      return <Loader2 size={16} className="animate-spin text-fg-secondary" />;
    case "live":
      return <CheckCircle2 size={16} className="text-fg-brand-primary" />;
    case "blocked":
      return <AlertTriangle size={16} className="text-fg-secondary" />;
    case "failed":
      return <AlertTriangle size={16} className="text-fg-error-on-surface" />;
  }
}

function handoffTitle(state: HandoffState): string {
  switch (state.kind) {
    case "opening":
      return "Publishing in the Studio";
    case "running":
      return `${state.step} · ${seconds(state.elapsedMs)}`;
    case "checking":
      return "Checking the site renders";
    case "live":
      return `Live after ${seconds(state.ms)}`;
    case "blocked":
      return "Publishing needs the Studio";
    case "failed":
      return "Not published";
  }
}

function handoffBody(state: HandoffState): string {
  switch (state.kind) {
    case "opening":
      return "A Studio tab is opening to build your change. You can keep working here.";
    case "running":
      return "Building in a Studio tab. You can keep working here; this updates as it goes.";
    case "checking":
      return "Built. Val is checking the new version and will put it live. You can keep working here.";
    case "live":
      return "Your change is on the site. This page still shows the version it loaded with.";
    case "blocked":
      return "Your browser blocked the Studio tab that builds the site. Your changes are kept and nothing is lost.";
    case "failed":
      return state.message;
  }
}

function CardButton({
  children,
  onClick,
  icon,
  primary = false,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md font-medium",
        primary
          ? "bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary hover:bg-bg-brand-primary-hover"
          : "border border-border-float text-fg-primary hover:bg-bg-secondary",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export type PublishStep = {
  label: string;
  status: "done" | "current" | "todo" | "failed";
  /** How long it took, for a finished step, or has taken, for the current one. */
  ms?: number;
};

export type PublishPageResult =
  | { kind: "live"; ms: number; closingInS?: number }
  /**
   * The build is the content service's now: it checks the site renders and
   * puts it live without this tab, and the page that opened it says when.
   */
  | { kind: "handed-off"; closingInS?: number }
  | { kind: "failed"; message: string; details?: string };

/**
 * The technical half of a failure, closed by default.
 *
 * Kept on the page rather than only in the console, because it is what someone
 * reporting the failure has to paste -- and a phone has no console to open.
 */
export function FailureDetails({ details }: { details: string }) {
  return (
    <details className="mt-2 text-xs text-fg-secondary-alt">
      <summary className="cursor-pointer select-none hover:text-fg-secondary">
        Details
      </summary>
      <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
        {details}
      </p>
    </details>
  );
}

/**
 * The Studio tab the overlay opened, while it builds and publishes one commit.
 *
 * A page of its own rather than the Studio behind a toast: the person did not
 * come here to edit, they came because the site sent them, and the one thing
 * this tab has to say is how far the publish has got.
 */
export function StudioPublishPage({
  commit,
  steps,
  elapsedMs,
  result,
  onViewSite,
  onOpenStudio,
  onClose,
}: {
  commit: string;
  steps: PublishStep[];
  elapsedMs: number;
  result?: PublishPageResult;
  onViewSite?: () => void;
  onOpenStudio?: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="min-h-full w-full flex items-center justify-center bg-bg-primary text-fg-primary p-6">
      <div className="w-full max-w-md rounded-xl border border-border-float bg-bg-float shadow-sm p-6">
        <p className="text-xs text-fg-secondary-alt font-mono">
          {commit.slice(0, 7)}
        </p>
        <h1 className="mt-1 text-lg font-semibold">
          {result?.kind === "live"
            ? `Live after ${seconds(result.ms)}`
            : result?.kind === "handed-off"
              ? "Built and handed over"
              : result?.kind === "failed"
                ? "Not published"
                : "Publishing your change"}
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          {result?.kind === "live"
            ? "Your change is on the site."
            : result?.kind === "handed-off"
              ? "Val is checking that the site renders and will put it live. You can close this tab: the page you published from says when it is live."
              : result?.kind === "failed"
                ? result.message
                : `Started from the site ${seconds(elapsedMs)} ago. Keep this open until it is built.`}
        </p>
        {result?.kind === "failed" && result.details && (
          <FailureDetails details={result.details} />
        )}
        <ol className="mt-5 space-y-2.5">
          {steps.map((step) => (
            <li key={step.label} className="flex items-center gap-2.5 text-sm">
              <StepIcon status={step.status} />
              <span
                className={cn(
                  "flex-1",
                  step.status === "todo" && "text-fg-secondary-alt",
                  step.status === "failed" && "text-fg-error-on-surface",
                )}
              >
                {step.label}
              </span>
              {step.ms !== undefined && step.status !== "todo" && (
                <span className="tabular-nums text-xs text-fg-secondary-alt">
                  {seconds(step.ms)}
                </span>
              )}
            </li>
          ))}
        </ol>
        {result && (
          <div className="mt-6 flex items-center gap-2">
            {result.kind === "live" && onViewSite && (
              <button
                type="button"
                onClick={onViewSite}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary hover:bg-bg-brand-primary-hover"
              >
                <ExternalLink size={13} />
                View the site
              </button>
            )}
            {result.kind === "failed" && onOpenStudio && (
              <button
                type="button"
                onClick={onOpenStudio}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-bg-brand-primary text-fg-brand-primary border border-border-brand-primary hover:bg-bg-brand-primary-hover"
              >
                Open the Studio
              </button>
            )}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center h-8 px-3 rounded-md text-xs font-medium border border-border-float hover:bg-bg-secondary"
              >
                Close
              </button>
            )}
            {(result.kind === "live" || result.kind === "handed-off") &&
              result.closingInS !== undefined && (
                <span className="ml-auto text-xs text-fg-secondary-alt">
                  Closing in {result.closingInS}s
                </span>
              )}
          </div>
        )}
      </div>
    </div>
  );
}

function StepIcon({ status }: { status: PublishStep["status"] }) {
  switch (status) {
    case "done":
      return (
        <CheckCircle2 size={15} className="shrink-0 text-fg-brand-primary" />
      );
    case "current":
      return (
        <Loader2
          size={15}
          className="shrink-0 animate-spin text-fg-secondary"
        />
      );
    case "todo":
      return <Circle size={15} className="shrink-0 text-fg-secondary-alt" />;
    case "failed":
      return (
        <AlertTriangle
          size={15}
          className="shrink-0 text-fg-error-on-surface"
        />
      );
  }
}
