import {
  ArrowRight,
  Check,
  Circle,
  Hammer,
  Loader2,
  Package,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/designSystem/dialog";
import type { PublishProposalState } from "../components/proposals/PublishProposalDialog";
import { errorsByFile } from "../proposals/proposalTypecheck";
import type {
  UpgradeFooter,
  UpgradeProgressView,
  UpgradeStepState,
} from "./upgradeProgress";

/** How many new errors are listed before "and N more". */
const LISTED_ERRORS = 50;

type StepMark = UpgradeStepState | "lockfile" | "required" | "tap";

function StepIcon({ state }: { state: StepMark }) {
  switch (state) {
    case "done":
      return <Check size={14} className="mt-px shrink-0 text-fg-proposal" />;
    case "running":
      return (
        <Loader2
          size={14}
          className="mt-px shrink-0 animate-spin text-fg-proposal"
        />
      );
    case "failed":
      return (
        <X size={14} className="mt-px shrink-0 text-fg-error-on-surface" />
      );
    case "lockfile":
    case "required":
    case "tap":
      return <Circle size={14} className="mt-px shrink-0 text-fg-proposal" />;
    case "waiting":
      return <Circle size={14} className="mt-px shrink-0 text-fg-disabled" />;
  }
}

function Step({
  state,
  title,
  children,
}: {
  state: StepMark;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <StepIcon state={state} />
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
        <span
          className={cn(
            state === "waiting" ? "text-fg-secondary" : "text-fg-primary",
          )}
        >
          {title}
        </span>
        {children}
      </span>
    </li>
  );
}

/** A running step's bar, when the step can say how far along it is. */
function Progress({ percent }: { percent: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1 w-full overflow-hidden rounded-full bg-bg-proposal-soft"
    >
      <div
        className="h-full rounded-full bg-bg-proposal transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function publishStep(publish: PublishProposalState): {
  state: StepMark;
  title: string;
} {
  switch (publish.kind) {
    case "merged":
      return { state: "done", title: "Published" };
    case "publishing":
      return {
        state: "running",
        title:
          publish.step === "building"
            ? "Building the site with the upgrade…"
            : publish.step === "saving"
              ? "Saving the proposal…"
              : "Publishing…",
      };
    case "failed":
      return { state: "failed", title: "It was not published" };
    default:
      return { state: "waiting", title: "Publish" };
  }
}

/**
 * An upgrade, from the moment its proposal opens to the site running it
 * (valbuild/home `docs/adept.md`, "How one Upgrade goes"): computed, its
 * dependencies built, typechecked, built, published -- in this one dialog.
 *
 * The steps run by themselves. What needs a person is the footer's one
 * button, where Publish is: Try again when a step failed, Publish when it is
 * ready, Go to site once it is published, and -- where this page cannot build
 * and the browser opens the tab that does only from a tap -- Build.
 *
 * `view` is `null` while the proposal is being read: the dialog is open from
 * the moment the page is, rather than after everything has loaded.
 */
export function UpgradeProgressDialog({
  open,
  onOpenChange,
  displayName,
  view,
  publish,
  footer,
  onComputeLockfile,
  onTypecheck,
  onBuild,
  onPublish,
  onRetryPublish,
  onReview,
  onGoToSite,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` while the proposal is being read. */
  displayName: string | null;
  view: UpgradeProgressView | null;
  publish: PublishProposalState;
  footer: UpgradeFooter;
  onComputeLockfile: () => void;
  onTypecheck: () => void;
  onBuild: () => void;
  onPublish: () => void;
  onRetryPublish: () => void;
  /** The proposal's own Publish dialog, for a check only it can clear. */
  onReview: () => void;
  /** `undefined` when the project has not said where its site is. */
  onGoToSite?: () => void;
  portalContainer?: HTMLElement | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="max-w-lg gap-0 border-border-float bg-bg-float p-0"
      >
        <div className="flex flex-col gap-1.5 px-5 pb-3 pt-5">
          <DialogTitle className="text-sm font-semibold">
            {displayName ?? "Upgrade"}
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-secondary">
            An upgrade of the site&apos;s dependencies, in a proposal of its
            own. The site changes when it is published.
          </DialogDescription>
        </div>
        <ol className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 pb-4">
          {view === null ? (
            <Step state="running" title="Loading the upgrade…" />
          ) : (
            <Steps view={view} publish={publish} />
          )}
        </ol>
        <div
          role="group"
          aria-label="Next step"
          className="flex items-center justify-between gap-3 border-t border-border-float px-5 py-3"
        >
          <span
            role={footer.action.kind === "retry" ? "alert" : undefined}
            className="text-xs text-fg-secondary"
          >
            {footer.note}
          </span>
          <FooterButton
            footer={footer}
            onClose={() => onOpenChange(false)}
            onComputeLockfile={onComputeLockfile}
            onTypecheck={onTypecheck}
            onBuild={onBuild}
            onPublish={onPublish}
            onRetryPublish={onRetryPublish}
            onReview={onReview}
            {...(onGoToSite !== undefined ? { onGoToSite } : {})}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Steps({
  view,
  publish,
}: {
  view: UpgradeProgressView;
  publish: PublishProposalState;
}) {
  const { upgrade, dependencies, typecheck, build } = view;
  const moved = upgrade.changes.filter((change) => change.to !== null);
  const listed = typecheck.errors.slice(0, LISTED_ERRORS);
  const more = (typecheck.newErrors ?? 0) - listed.length;
  const published = publishStep(publish);
  return (
    <>
      <Step
        state={
          upgrade.state === "computing"
            ? "running"
            : upgrade.state === "failed"
              ? "failed"
              : "done"
        }
        title={
          upgrade.state === "computing"
            ? "Computing the upgrade…"
            : upgrade.state === "nothing"
              ? "Nothing to upgrade: the dependencies are as new as this kind of upgrade allows."
              : upgrade.state === "failed"
                ? `The upgrade could not be computed${upgrade.error ? `: ${upgrade.error}` : "."}`
                : moved.length === 1
                  ? "1 dependency moves"
                  : `${moved.length} dependencies move`
        }
      >
        {moved.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-fg-secondary">
            {moved.map((change) => (
              <li key={change.name}>
                <span className="font-mono text-fg-primary">{change.name}</span>{" "}
                {change.from ?? "new"} → {change.to}
                {change.kind === "major" && (
                  <span className="text-fg-warning-primary"> (major)</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {upgrade.path === "cves" &&
          upgrade.vulnerableBefore !== null &&
          upgrade.vulnerableAfter !== null && (
            <span className="text-fg-secondary">
              Vulnerable packages: {upgrade.vulnerableBefore} before,{" "}
              {upgrade.vulnerableAfter} after.
            </span>
          )}
      </Step>
      {upgrade.state !== "nothing" && upgrade.state !== "failed" && (
        <>
          <Step
            state={dependencies.state}
            title={
              dependencies.state === "lockfile"
                ? "The lockfile does not match the dependencies."
                : dependencies.state === "failed"
                  ? `The dependencies could not be built${dependencies.detail ? `: ${dependencies.detail}` : "."}`
                  : dependencies.state === "running"
                    ? `${dependencies.detail ?? "Building the dependencies"}…`
                    : dependencies.state === "done"
                      ? "Dependencies built"
                      : "Building the dependencies"
            }
          />
          <Step
            state={
              typecheck.state === "done" && (typecheck.newErrors ?? 0) > 0
                ? "failed"
                : typecheck.state
            }
            title={
              typecheck.state === "running"
                ? `Typechecking…${typecheck.detail ? ` ${typecheck.detail}` : ""}`
                : typecheck.state === "failed"
                  ? `The typecheck did not finish: ${typecheck.detail ?? "it failed"}`
                  : typecheck.state === "done"
                    ? typecheck.newErrors === 0
                      ? "Typechecked: 0 new type errors"
                      : `${typecheck.newErrors} new type ${typecheck.newErrors === 1 ? "error" : "errors"}. Fix them in this proposal, then typecheck again.`
                    : "Typechecking"
            }
          >
            {typecheck.state === "done" && listed.length > 0 && (
              <div className="flex w-full flex-col gap-2">
                {errorsByFile(listed).map(([file, errors]) => (
                  <div key={file} className="flex flex-col gap-0.5">
                    <span className="font-mono text-fg-primary">{file}</span>
                    <ul className="flex flex-col gap-0.5 text-fg-secondary">
                      {errors.map((error, at) => (
                        <li key={`${error.line}:${error.column}:${at}`}>
                          {error.line}:{error.column} TS{error.code}{" "}
                          {error.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {more > 0 && (
                  <span className="text-fg-secondary">and {more} more</span>
                )}
              </div>
            )}
          </Step>
          <Step
            state={build.state}
            title={
              build.state === "running"
                ? `Building…${build.detail ? ` ${build.detail}` : ""}`
                : build.state === "failed"
                  ? "The build did not finish"
                  : build.state === "tap"
                    ? "Building, in a new tab"
                    : build.state === "done"
                      ? "Built: its preview shows the upgrade"
                      : "Building"
            }
          >
            {build.state === "running" && build.percent !== null && (
              <Progress percent={build.percent} />
            )}
            {build.state === "failed" && build.detail !== null && (
              <span className="text-fg-secondary">{build.detail}</span>
            )}
          </Step>
          <Step state={published.state} title={published.title}>
            {publish.kind === "failed" && (
              <span className="text-fg-secondary">{publish.message}</span>
            )}
          </Step>
        </>
      )}
    </>
  );
}

function FooterButton({
  footer,
  onClose,
  onComputeLockfile,
  onTypecheck,
  onBuild,
  onPublish,
  onRetryPublish,
  onReview,
  onGoToSite,
}: {
  footer: UpgradeFooter;
  onClose: () => void;
  onComputeLockfile: () => void;
  onTypecheck: () => void;
  onBuild: () => void;
  onPublish: () => void;
  onRetryPublish: () => void;
  onReview: () => void;
  onGoToSite?: () => void;
}) {
  const { action } = footer;
  switch (action.kind) {
    case "retry":
      return (
        <Button
          size="sm"
          onClick={
            action.step === "typecheck"
              ? onTypecheck
              : action.step === "build"
                ? onBuild
                : onRetryPublish
          }
        >
          <RefreshCw size={13} /> Try again
        </Button>
      );
    case "build":
      return (
        <Button size="sm" onClick={onBuild}>
          <Hammer size={13} /> Build
        </Button>
      );
    case "lockfile":
      return (
        <Button size="sm" onClick={onComputeLockfile}>
          <Package size={13} /> Compute lockfile
        </Button>
      );
    case "publish":
      return (
        <Button size="sm" disabled={!action.enabled} onClick={onPublish}>
          {action.busy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Upload size={13} />
          )}
          Publish
        </Button>
      );
    case "review":
      return (
        <Button size="sm" onClick={onReview}>
          Review <ArrowRight size={13} />
        </Button>
      );
    case "site":
      return onGoToSite !== undefined ? (
        <Button size="sm" onClick={onGoToSite}>
          Go to site <ArrowRight size={13} />
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      );
    case "close":
      return (
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      );
  }
}
