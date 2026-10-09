import { useEffect, useRef, useState } from "react";
import { cn } from "./designSystem/cn";
import {
  elapsedMs,
  formatElapsed,
  formatTokens,
  isInProgress,
  outputTokensOf,
  type TurnPhase,
  type TurnStats,
} from "./aiTurnStats";

/**
 * The line under an assistant reply: what it is doing, for how long, and how
 * many output tokens it has produced — Claude Code's spinner line, in the
 * chat. The rules live in `aiTurnStats.ts`; this only draws them.
 */
export function TurnStatsLine({
  stats,
  phase,
  className,
}: {
  stats: TurnStats;
  phase: TurnPhase;
  className?: string;
}) {
  const inProgress = isInProgress(phase);
  const now = useNow(inProgress && stats.pausedAt === null);
  const tokens = outputTokensOf(stats);
  const shownTokens = useCountUp(tokens?.count ?? 0);
  const label = LABELS[phase];
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs touch:text-sm tabular-nums",
        inProgress ? "text-fg-secondary" : "text-fg-tertiary",
        className,
      )}
      title={
        tokens
          ? `${tokens.estimated ? "About " : ""}${tokens.count.toLocaleString("en-US")} output tokens`
          : undefined
      }
      data-testid="ai-turn-stats"
    >
      {inProgress && phase !== "waiting" && <Spinner />}
      {label && (
        <span className={cn(inProgress && "text-fg-primary")}>{label}</span>
      )}
      <span>{formatElapsed(elapsedMs(stats, now))}</span>
      {tokens && (
        <>
          <span aria-hidden>·</span>
          <span>
            {inProgress
              ? `↓ ${formatTokens(shownTokens)} tokens`
              : `${tokens.estimated ? "~" : ""}${formatTokens(shownTokens)} output tokens`}
          </span>
        </>
      )}
    </div>
  );
}

const LABELS: Record<TurnPhase, string> = {
  thinking: "Thinking…",
  writing: "Writing…",
  // The tool row above already names the tool.
  working: "Working…",
  waiting: "Waiting for your answer",
  done: "",
  stopped: "Stopped after",
  failed: "Failed after",
};

/** `Date.now()`, re-read every second while `running`. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [running]);
  return now;
}

/**
 * Eases from the last shown value to `target`, so a jump — the server's count
 * replacing our estimate, a tool round finishing — reads as counting up rather
 * than as the number being swapped.
 */
function useCountUp(target: number, durationMs = 600): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      shownRef.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);
  return shown;
}

// Every frame must be a character with no emoji form. "✳" (U+2733) was one of
// them, and iOS draws it as the green ✳️ emoji tile in the middle of the spin.
const SPINNER_FRAMES = ["·", "✢", "✷", "✶", "✻", "✽", "✻", "✶", "✷", "✢"];

function Spinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const interval = setInterval(
      () => setFrame((f) => (f + 1) % SPINNER_FRAMES.length),
      120,
    );
    return () => clearInterval(interval);
  }, []);
  return (
    <span
      aria-hidden
      className="inline-block w-3 text-center text-fg-brand-primary motion-reduce:hidden"
    >
      {SPINNER_FRAMES[frame]}
    </span>
  );
}
