import {
  AlertTriangle,
  ArrowRight,
  Check,
  Circle,
  ExternalLink,
  Hammer,
  Package,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import type { PublishProposalState } from "../components/proposals/PublishProposalDialog";
import { errorsByFile } from "../proposals/proposalTypecheck";
import { withoutUpgradeTab } from "./upgradeTab";
import type {
  UpgradeFooter,
  UpgradeProgressView,
  UpgradeStepState,
} from "./upgradeProgress";
import { Spinner } from "../components/designSystem/spinner";

/** How many new errors are listed before "and N more". */
const LISTED_ERRORS = 50;

type StepMark = UpgradeStepState | "lockfile" | "required" | "tap";

function StepIcon({ state }: { state: StepMark }) {
  switch (state) {
    case "done":
      return <Check size={14} className="mt-px shrink-0 text-fg-proposal" />;
    case "running":
      return <Spinner size={14} className="mt-px text-fg-proposal" />;
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
 * The upgrade tab's page (`upgradeTab.ts`): an upgrade from the moment its
 * proposal opens to the site running it (valbuild/home `docs/adept.md`, "How
 * one Upgrade goes"): computed, its dependencies built, typechecked, built,
 * published -- in this one tab, on every device.
 *
 * The steps run by themselves. What needs a person is in the footer, and the
 * next step is always its right-hand button, where Publish is: Try again
 * when a step failed, Publish when it is ready, Go to site once it is
 * published. Beside Publish, Review opens the proposal in the Studio, to see
 * its preview and check the merge there. On the left, Discard upgrade closes
 * the proposal; once it is published, Close tab.
 *
 * `view` is `null` while the proposal is being read: the page is up from the
 * moment the tab is, rather than after everything has loaded.
 */
export function UpgradeProgressPage({
  displayName,
  view,
  publish,
  footer,
  onComputeLockfile,
  onTypecheck,
  onBuild,
  onRender,
  onPublish,
  onRetryPublish,
  onCheckMerge,
  onReview,
  onDiscard,
  onGoToSite,
  onCloseTab,
}: {
  /** `null` while the proposal is being read. */
  displayName: string | null;
  view: UpgradeProgressView | null;
  publish: PublishProposalState;
  footer: UpgradeFooter;
  onComputeLockfile: () => void;
  onTypecheck: () => void;
  onBuild: () => void;
  /** Render the build on the platform again. */
  onRender: () => void;
  onPublish: () => void;
  onRetryPublish: () => void;
  /** The proposal's own Publish dialog, for a check only it can clear. */
  onCheckMerge: () => void;
  /** The proposal in the Studio: its preview, and the merge checked there. */
  onReview: () => void;
  /** Close the proposal, after asking. */
  onDiscard: () => void;
  /** `undefined` when the project has not said where its site is. */
  onGoToSite?: () => void;
  onCloseTab: () => void;
}) {
  const settled = publish.kind === "merged";
  const pressed = publish.kind === "publishing";
  const staged = view !== null && view.upgrade.state === "staged";
  return (
    <div className="flex min-h-svh w-full items-start justify-center bg-bg-primary p-4 text-fg-primary sm:items-center sm:p-6">
      <main className="flex w-full max-w-lg flex-col rounded-xl border border-border-float bg-bg-float shadow-sm">
        <div className="flex flex-col gap-1.5 px-5 pb-3 pt-5">
          <h1 className="text-base font-semibold">
            {displayName ?? "Upgrade"}
          </h1>
          <p className="text-xs text-fg-secondary">
            An upgrade of the site&apos;s dependencies, in a proposal of its
            own. The site changes when it is published.
          </p>
        </div>
        <ol className="flex flex-col gap-3 px-5 pb-4">
          {view === null ? (
            <Step state="running" title="Loading the upgrade…" />
          ) : (
            <Steps view={view} publish={publish} />
          )}
        </ol>
        {!settled && !pressed && view !== null && (
          <p className="px-5 pb-3 text-xs text-fg-secondary-alt">
            Keep this tab open until it is done. Closed, it can be opened again
            from the upgrade&apos;s proposal.
          </p>
        )}
        <div className="flex flex-col gap-2 border-t border-border-float px-5 py-3">
          <span
            role={footer.action.kind === "retry" ? "alert" : undefined}
            className="text-xs text-fg-secondary"
          >
            {footer.note}
          </span>
          <div
            role="group"
            aria-label="Next step"
            className="flex items-center justify-between gap-2"
          >
            {settled ? (
              <Button size="sm" variant="outline" onClick={onCloseTab}>
                Close tab
              </Button>
            ) : view !== null && !pressed ? (
              <Button size="sm" variant="ghost" onClick={onDiscard}>
                <Trash2 size={13} /> Discard upgrade
              </Button>
            ) : (
              <span />
            )}
            <span className="flex items-center gap-2">
              {staged && !settled && !pressed && (
                <Button size="sm" variant="secondary" onClick={onReview}>
                  Review <ExternalLink size={13} />
                </Button>
              )}
              <NextStep
                footer={footer}
                onComputeLockfile={onComputeLockfile}
                onTypecheck={onTypecheck}
                onBuild={onBuild}
                onRender={onRender}
                onPublish={onPublish}
                onRetryPublish={onRetryPublish}
                onCheckMerge={onCheckMerge}
                onCloseTab={onCloseTab}
                {...(onGoToSite !== undefined ? { onGoToSite } : {})}
              />
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

function Steps({
  view,
  publish,
}: {
  view: UpgradeProgressView;
  publish: PublishProposalState;
}) {
  const { upgrade, dependencies, typecheck, build, render } = view;
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
          <Step
            state={render.state}
            title={
              render.state === "running"
                ? "Rendering the new build on the platform…"
                : render.state === "failed"
                  ? render.retryable
                    ? "The new build could not be rendered"
                    : "The new build does not render"
                  : render.state === "done"
                    ? render.deferred
                      ? "Rendered on the platform when it is published"
                      : "Renders on the platform"
                    : "Rendering on the platform"
            }
          >
            {render.state === "failed" && render.detail !== null && (
              <span className="text-fg-secondary">{render.detail}</span>
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

/** The footer's right-hand button: the next step, where Publish is. */
function NextStep({
  footer,
  onComputeLockfile,
  onTypecheck,
  onBuild,
  onRender,
  onPublish,
  onRetryPublish,
  onCheckMerge,
  onGoToSite,
  onCloseTab,
}: {
  footer: UpgradeFooter;
  onComputeLockfile: () => void;
  onTypecheck: () => void;
  onBuild: () => void;
  onRender: () => void;
  onPublish: () => void;
  onRetryPublish: () => void;
  onCheckMerge: () => void;
  onGoToSite?: () => void;
  onCloseTab: () => void;
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
                : action.step === "render"
                  ? onRender
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
          {action.busy ? <Spinner size={14} /> : <Upload size={13} />}
          Publish
        </Button>
      );
    case "review":
      return (
        <Button size="sm" onClick={onCheckMerge}>
          Check the merge <ArrowRight size={13} />
        </Button>
      );
    case "site":
      return onGoToSite !== undefined ? (
        <Button size="sm" onClick={onGoToSite}>
          Go to site <ArrowRight size={13} />
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onCloseTab}>
          Close tab
        </Button>
      );
    case "close":
      // Nothing more can happen here: Discard, on the left, closes it.
      return null;
  }
}

/** The upgrade tab, somewhere it has no upgrade to run: the way to the Studio. */
export function UpgradeTabMessage({ message }: { message: string }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-bg-primary p-6 text-fg-primary">
      <div
        role="status"
        className="w-full max-w-md rounded-xl border border-border-float bg-bg-float p-6 shadow-sm"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle
            size={18}
            className="shrink-0 text-fg-warning-primary"
          />
          <h1 className="text-lg font-semibold">No upgrade here</h1>
        </div>
        <p className="mt-2 text-sm text-fg-secondary">{message}</p>
        <div className="mt-4">
          <a
            href={withoutUpgradeTab(window.location.href)}
            className="inline-flex h-8 items-center rounded-md border border-border-primary px-3 text-sm font-medium hover:bg-bg-float-raised"
          >
            Open the Studio
          </a>
        </div>
      </div>
    </div>
  );
}
