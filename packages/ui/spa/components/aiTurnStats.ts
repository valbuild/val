/**
 * How long an assistant turn has taken and how many output tokens it has
 * produced — the line under a reply.
 *
 * Pure and React-free, like `aiChatBubble.ts`: every rule here is one that is
 * easy to get subtly wrong (a clock that keeps running while the user answers
 * a question, an estimate that outlives the exact count) and cheap to test.
 *
 * Only OUTPUT tokens are counted. The total the server bills includes the
 * whole conversation re-sent on every tool round, so a short answer after five
 * tool calls would read as tens of thousands of tokens.
 */

export type TurnStats = {
  /** When the prompt was sent (`Date.now()`), not when the first chunk landed. */
  startedAt: number;
  /** Set once the turn has settled; the clock stops here. */
  endedAt: number | null;
  /**
   * Time spent waiting on the user — an open `ask_user_question` card — which
   * the clock leaves out: it measures the assistant, not the person.
   */
  pausedMs: number;
  /** Set while a question card is open. */
  pausedAt: number | null;
  /** Characters of reply text streamed so far: the estimate's input. */
  streamedChars: number;
  /**
   * The server's count, once it has sent one. Cumulative for the turn, and
   * always preferred over our own estimate: it also sees what never reaches
   * the chat as text — thinking, tool arguments.
   */
  reportedOutputTokens: number | null;
  /** False while `reportedOutputTokens` is the server's own running estimate. */
  reportedIsExact: boolean;
  /** Settled because the user pressed stop. */
  stopped: boolean;
};

export type TurnPhase =
  | "thinking"
  | "writing"
  | "working"
  | "waiting"
  | "done"
  | "stopped"
  | "failed";

/** Rough, and only ever a stand-in until the server reports a real count. */
const CHARS_PER_TOKEN = 4;

export function startTurn(startedAt: number): TurnStats {
  return {
    startedAt,
    endedAt: null,
    pausedMs: 0,
    pausedAt: null,
    streamedChars: 0,
    reportedOutputTokens: null,
    reportedIsExact: false,
    stopped: false,
  };
}

export function addStreamedText(stats: TurnStats, chunk: string): TurnStats {
  return { ...stats, streamedChars: stats.streamedChars + chunk.length };
}

export function reportOutputTokens(
  stats: TurnStats,
  outputTokens: number,
  exact: boolean,
): TurnStats {
  if (stats.endedAt !== null) return stats;
  return {
    ...stats,
    reportedOutputTokens: outputTokens,
    reportedIsExact: exact,
  };
}

/**
 * Pause or resume the clock to match whether the turn is waiting on the user.
 * Idempotent, so it can be applied after every change to a message's tools
 * without each caller tracking the transition.
 */
export function syncPause(
  stats: TurnStats,
  waitingOnUser: boolean,
  now: number,
): TurnStats {
  if (stats.endedAt !== null) return stats;
  if (waitingOnUser && stats.pausedAt === null) {
    return { ...stats, pausedAt: now };
  }
  if (!waitingOnUser && stats.pausedAt !== null) {
    return {
      ...stats,
      pausedAt: null,
      pausedMs: stats.pausedMs + (now - stats.pausedAt),
    };
  }
  return stats;
}

export function endTurn(
  stats: TurnStats,
  now: number,
  outcome: { outputTokens?: number; stopped?: boolean } = {},
): TurnStats {
  if (stats.endedAt !== null) return stats;
  return {
    ...stats,
    endedAt: now,
    stopped: outcome.stopped ?? false,
    ...(outcome.outputTokens !== undefined
      ? { reportedOutputTokens: outcome.outputTokens, reportedIsExact: true }
      : {}),
  };
}

export function elapsedMs(stats: TurnStats, now: number): number {
  const until = stats.endedAt ?? now;
  // A turn can end while paused (an error while a card is open), so an open
  // pause is measured up to the end, not up to now.
  const openPause = stats.pausedAt !== null ? until - stats.pausedAt : 0;
  return Math.max(0, until - stats.startedAt - stats.pausedMs - openPause);
}

export type OutputTokens = { count: number; estimated: boolean };

/** `null` when there is nothing worth showing yet — or at all. */
export function outputTokensOf(stats: TurnStats): OutputTokens | null {
  if (stats.reportedOutputTokens !== null) {
    return stats.reportedOutputTokens > 0
      ? {
          count: stats.reportedOutputTokens,
          estimated: !stats.reportedIsExact,
        }
      : null;
  }
  if (stats.streamedChars === 0) return null;
  return {
    count: Math.ceil(stats.streamedChars / CHARS_PER_TOKEN),
    estimated: true,
  };
}

export function turnPhaseOf(message: {
  status: "streaming" | "complete" | "error";
  stopped: boolean;
  waitingOnUser: boolean;
  hasRunningTool: boolean;
  hasText: boolean;
}): TurnPhase {
  if (message.status === "error") return "failed";
  if (message.status !== "streaming") {
    return message.stopped ? "stopped" : "done";
  }
  if (message.waitingOnUser) return "waiting";
  if (message.hasRunningTool) return "working";
  return message.hasText ? "writing" : "thinking";
}

export function isInProgress(phase: TurnPhase): boolean {
  return (
    phase === "thinking" ||
    phase === "writing" ||
    phase === "working" ||
    phase === "waiting"
  );
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatTokens(value: number): string {
  // Rounded first: the count-up animation passes fractions, and 999.6 must
  // read "1.0k", not "1000".
  const tokens = Math.round(value);
  if (tokens < 1000) return `${tokens}`;
  // 9 950 and up would round to "10.0k"; the next branch says "10k".
  if (tokens < 9_950) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.round(tokens / 1000)}k`;
}
