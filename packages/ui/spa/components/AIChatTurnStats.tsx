import { useEffect, useRef, useState } from "react";
import { cn } from "./designSystem/cn";

/**
 * What a turn is doing right now, as far as the status line says.
 *
 * `waiting` is an ask_user_question card that is open: the clock is the
 * user's then, not the model's, so it is shown paused.
 */
export type TurnPhase =
  | { type: "thinking" }
  | { type: "writing" }
  | { type: "tool"; name: string }
  | { type: "waiting" }
  | { type: "done" }
  | { type: "stopped" }
  | { type: "error" };

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${Math.round(tokens)}`;
  if (tokens < 10_000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Eases from the last shown value to `target`, so a jump (an exact count
 * replacing an estimate, a tool round finishing) reads as counting rather
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

const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳", "✢"];

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
      className="inline-block w-3 text-center text-fg-brand-primary"
    >
      {SPINNER_FRAMES[frame]}
    </span>
  );
}

function phaseLabel(phase: TurnPhase): string {
  switch (phase.type) {
    case "thinking":
      return "Thinking…";
    case "writing":
      return "Writing…";
    case "tool":
      // The tool row above already names the tool.
      return "Working…";
    case "waiting":
      return "Waiting for your answer";
    case "done":
      return "";
    case "stopped":
      return "Stopped after";
    case "error":
      return "Failed after";
  }
}

export function TurnStatsLine({
  phase,
  elapsedMs,
  outputTokens,
  className,
}: {
  phase: TurnPhase;
  elapsedMs: number;
  /** Undefined until the first chunk or usage report arrives. */
  outputTokens: number | undefined;
  className?: string;
}) {
  const tokens = useCountUp(outputTokens ?? 0);
  const inProgress =
    phase.type === "thinking" ||
    phase.type === "writing" ||
    phase.type === "tool" ||
    phase.type === "waiting";
  const label = phaseLabel(phase);
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs touch:text-sm tabular-nums",
        inProgress ? "text-fg-secondary" : "text-fg-tertiary",
        className,
      )}
      title={
        outputTokens !== undefined
          ? `${Math.round(outputTokens).toLocaleString("en-US")} output tokens`
          : undefined
      }
    >
      {inProgress && phase.type !== "waiting" && <Spinner />}
      {label && (
        <span className={cn(inProgress && "text-fg-primary")}>{label}</span>
      )}
      <span>{formatElapsed(elapsedMs)}</span>
      {outputTokens !== undefined && (
        <>
          <span aria-hidden>·</span>
          <span>
            {inProgress ? "↓ " : ""}
            {formatTokens(tokens)} {inProgress ? "tokens" : "output tokens"}
          </span>
        </>
      )}
    </div>
  );
}
