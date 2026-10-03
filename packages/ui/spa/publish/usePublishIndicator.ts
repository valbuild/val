import { useEffect, useMemo, useState } from "react";
import type { ShellDeployment } from "../components/shell/types";
import {
  RUNNING_JOB_STALE_MS,
  publishIndicator,
  type ObservedJob,
  type PublishIndicator,
} from "./publishIndicator";
import type { StudioDeployState } from "./useStudioDeploy";

/**
 * `publishIndicator` with a clock: decided now, and again at the moment it
 * would change without anything else changing -- the end of the edge window,
 * or a running job going stale. One timer for that moment rather than a tick
 * every second, because what reads this is the whole shell.
 */
export function usePublishIndicator(input: {
  own: StudioDeployState;
  builderStep: string | null;
  jobs: readonly ObservedJob[];
  deployments: ShellDeployment[] | undefined;
  studioIsDeployer: boolean;
}): PublishIndicator {
  const { own, builderStep, jobs, deployments, studioIsDeployer } = input;
  /** The last time the moment below arrived. */
  const [tick, setTick] = useState(() => Date.now());
  const { indicator, nextAt } = useMemo(() => {
    const now = Math.max(tick, Date.now());
    const indicator = publishIndicator({
      own,
      builderStep,
      jobs,
      deployments,
      studioIsDeployer,
      now,
    });
    const nextAt =
      indicator.kind === "reaching"
        ? indicator.everywhereAt
        : indicator.kind === "publishing" && !indicator.mine
          ? Math.min(
              ...jobs
                .filter((job) => job.status === "running")
                .map((job) => job.seenAt + RUNNING_JOB_STALE_MS),
            )
          : null;
    return { indicator, nextAt };
  }, [own, builderStep, jobs, deployments, studioIsDeployer, tick]);
  useEffect(() => {
    if (nextAt === null || !Number.isFinite(nextAt)) return;
    const timer = setTimeout(
      () => setTick(Date.now()),
      Math.max(0, nextAt - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [nextAt]);
  return indicator;
}
