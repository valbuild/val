import {
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
import { errorsByFile } from "../proposals/proposalTypecheck";
import type { UpgradeProgressView, UpgradeStepState } from "./upgradeProgress";

/** How many new errors are listed before "and N more". */
const LISTED_ERRORS = 50;

function StepIcon({
  state,
}: {
  state: UpgradeStepState | "lockfile" | "required";
}) {
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
  state: UpgradeStepState | "lockfile" | "required";
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <StepIcon state={state} />
      <span className="flex min-w-0 flex-col items-start gap-1.5">
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

/**
 * An upgrade proposal, followed to Publish (valbuild/home `docs/adept.md`,
 * decision 20): computed, its dependencies built, typechecked and built.
 * Publish is pressed here when the typecheck found no new errors and the
 * proposal is built; otherwise it says what failed, and the proposal stays
 * open for a fix.
 */
export function UpgradeProgressDialog({
  open,
  onOpenChange,
  displayName,
  view,
  onComputeLockfile,
  onTypecheck,
  onBuild,
  onPublish,
  portalContainer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayName: string;
  view: UpgradeProgressView;
  onComputeLockfile: () => void;
  onTypecheck: () => void;
  onBuild: () => void;
  onPublish: () => void;
  portalContainer?: HTMLElement | null;
}) {
  const { upgrade, dependencies, typecheck, build } = view;
  const moved = upgrade.changes.filter((change) => change.to !== null);
  const listed = typecheck.errors.slice(0, LISTED_ERRORS);
  const more = (typecheck.newErrors ?? 0) - listed.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        container={portalContainer}
        className="max-w-lg gap-0 border-border-float bg-bg-float p-0"
      >
        <div className="flex flex-col gap-1.5 px-5 pb-3 pt-5">
          <DialogTitle className="text-sm font-semibold">
            {displayName}
          </DialogTitle>
          <DialogDescription className="text-xs text-fg-secondary">
            An upgrade of the site&apos;s dependencies, in a proposal of its
            own. The site changes when it is published.
          </DialogDescription>
        </div>
        <ol className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto px-5 pb-4">
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
                    <span className="font-mono text-fg-primary">
                      {change.name}
                    </span>{" "}
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
                        : "Building the dependencies"
                }
              >
                {dependencies.state === "lockfile" && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={onComputeLockfile}
                  >
                    <Package size={13} /> Compute lockfile
                  </Button>
                )}
              </Step>
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
                          ? "0 new type errors"
                          : `${typecheck.newErrors} new type ${typecheck.newErrors === 1 ? "error" : "errors"}. Fix them in this proposal, then typecheck again.`
                        : "Typechecking"
                }
              >
                {typecheck.state === "done" && listed.length > 0 && (
                  <div className="flex w-full flex-col gap-2">
                    {errorsByFile(listed).map(([file, errors]) => (
                      <div key={file} className="flex flex-col gap-0.5">
                        <span className="font-mono text-fg-primary">
                          {file}
                        </span>
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
                {((typecheck.state === "failed" && typecheck.retryable) ||
                  (typecheck.state === "done" &&
                    (typecheck.newErrors ?? 0) > 0)) && (
                  <Button size="xs" variant="outline" onClick={onTypecheck}>
                    <RefreshCw size={13} /> Typecheck again
                  </Button>
                )}
              </Step>
              <Step
                state={build.state}
                title={
                  build.state === "running"
                    ? "Building…"
                    : build.state === "failed"
                      ? `The build failed${build.detail ? `: ${build.detail}` : "."}`
                      : build.state === "required"
                        ? "Build it, and its preview shows the upgrade"
                        : build.state === "done"
                          ? "Built: its preview shows the upgrade"
                          : "Building"
                }
              >
                {(build.state === "required" || build.state === "failed") && (
                  <Button size="xs" variant="outline" onClick={onBuild}>
                    <Hammer size={13} />{" "}
                    {build.state === "failed" ? "Build again" : "Build"}
                  </Button>
                )}
              </Step>
            </>
          )}
        </ol>
        <div className="flex items-center justify-between gap-3 border-t border-border-float px-5 py-3">
          <span className="text-xs text-fg-secondary">
            {view.canPublish
              ? "No new type errors, and built."
              : upgrade.state === "nothing"
                ? "Close this proposal: there is nothing to publish."
                : typecheck.state === "done" && (typecheck.newErrors ?? 0) > 0
                  ? "It stays open until the new errors are fixed."
                  : "Publish waits for the typecheck and the build."}
          </span>
          <Button size="sm" disabled={!view.canPublish} onClick={onPublish}>
            <Upload size={13} />
            Publish
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
