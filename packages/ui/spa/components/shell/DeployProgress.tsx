import { Loader2 } from "lucide-react";
import { deployPercent, describeDeploy } from "../../publish/deployProgress";
import type { StudioDeployState } from "../../publish/useStudioDeploy";

/**
 * A publish built in this tab, while it runs: "Publishing 42%" and a thin bar.
 *
 * Only for a publish the deploy list has no row for yet: once its commit is in
 * the list, the list's own summary says "Publishing 42%" instead, so the bar
 * never shows it twice. Gone as soon as it is done. A publish that went live says so in the deploy
 * summary beside it ("Live"), with the breakdown one click away in the list;
 * one that failed has its own message. This line is only for the wait.
 */
export function DeployProgress({ state }: { state: StudioDeployState }) {
  const line = describeDeploy(state);
  if (line === null || state.status !== "running") return null;
  const percent = deployPercent(state.phase);
  return (
    <span
      className="inline-flex items-center gap-2"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={line}
    >
      <Loader2 size={13} className="shrink-0 animate-spin" />
      <span className="tabular-nums">{line}</span>
      <ProgressBar percent={percent} className="w-16" />
    </span>
  );
}

/** The thin bar a running publish draws beside its percentage. */
export function ProgressBar({
  percent,
  className,
}: {
  percent: number;
  className?: string;
}) {
  return (
    <span
      className={`block h-1 overflow-hidden rounded-full bg-border-primary ${className ?? ""}`}
    >
      <span
        className="block h-full rounded-full bg-bg-brand-secondary transition-[width] duration-500"
        style={{ width: `${percent}%` }}
      />
    </span>
  );
}
