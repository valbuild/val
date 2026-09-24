import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { describeDeploy } from "../../publish/deployProgress";
import type { StudioDeployState } from "../../publish/useStudioDeploy";

/**
 * The step a publish built in this tab is on, and how long it has run.
 *
 * The publish tracked every step all along and showed none of them, so a build
 * that took a minute looked exactly like one that had stalled. Ticks once a
 * second while it runs; afterwards it says how long the publish took.
 */
export function DeployProgress({ state }: { state: StudioDeployState }) {
  const [now, setNow] = useState(() => Date.now());
  const running = state.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const line = describeDeploy(state, now);
  if (line === null) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 truncate"
      role="status"
      aria-live="polite"
    >
      {running ? (
        <Loader2 size={13} className="shrink-0 animate-spin" />
      ) : (
        <CheckCircle2 size={13} className="shrink-0 text-fg-brand-primary" />
      )}
      <span className="truncate">{line}</span>
    </span>
  );
}
