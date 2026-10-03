import { useEffect, useMemo, useState } from "react";
import type { ShellDeployment } from "../components/shell/types";
import {
  nextIndicatorChangeAt,
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
  builder: { step: string; percent: number | null } | null;
  jobs: readonly ObservedJob[];
  deployments: ShellDeployment[] | undefined;
  studioIsDeployer: boolean;
}): PublishIndicator {
  const { own, builder, jobs, deployments, studioIsDeployer } = input;
  /** The last time the moment below arrived. */
  const [tick, setTick] = useState(() => Date.now());
  const { indicator, nextAt } = useMemo(() => {
    const now = Math.max(tick, Date.now());
    const indicator = publishIndicator({
      own,
      builder,
      jobs,
      deployments,
      studioIsDeployer,
      now,
    });
    return { indicator, nextAt: nextIndicatorChangeAt(indicator, jobs, now) };
  }, [own, builder, jobs, deployments, studioIsDeployer, tick]);
  useEffect(() => {
    if (nextAt === null) return;
    const timer = setTimeout(
      () => setTick(Date.now()),
      Math.max(0, nextAt - Date.now()) + 50,
    );
    return () => clearTimeout(timer);
  }, [nextAt]);
  return indicator;
}
