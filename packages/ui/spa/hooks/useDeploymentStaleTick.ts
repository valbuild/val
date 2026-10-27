import { useEffect, useState } from "react";
import { msUntilNextStale } from "../utils/deploymentStatus";

/**
 * A counter that moves when one of these deploys crosses the hour after which
 * it stops being shown as in progress.
 *
 * Staleness is a function of the clock, so data alone never re-renders for
 * it: a deploy nobody reports on is exactly one whose row never changes. One
 * timeout, for the next crossing, and none at all when nothing is building.
 * Read `Date.now()` in whatever the counter invalidates — a time captured once
 * on mount is the bug this exists to prevent.
 *
 * Shared by the shell's deploy feed and the compare view's deploy line, which
 * describe the same deploy and must flip at the same moment.
 */
export function useDeploymentStaleTick(
  deployments: readonly { deploymentState: string; updatedAt: string }[],
): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const delay = msUntilNextStale(
      deployments.map((deployment) => ({
        state: deployment.deploymentState,
        updatedAt: deployment.updatedAt,
      })),
      Date.now(),
    );
    if (delay === null) return;
    // Just past the line, so the render it wakes finds the deploy stale.
    const timeout = setTimeout(() => setTick((n) => n + 1), delay + 1000);
    return () => clearTimeout(timeout);
  }, [deployments, tick]);
  return tick;
}
