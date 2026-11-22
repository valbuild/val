/**
 * How long a turn of the assistant took, from the person's message to its
 * answer, and how much of that was spent waiting on each tool.
 *
 * What it is for: the time a person waits for a turn is what checks moved
 * out of the conversation are meant to shorten, so it is measured before and
 * after -- and the time spent in `typecheck`, `lint` and the page tools is
 * the part that moves. Tools answered in parallel overlap, so the tools'
 * times can add up to more than the turn's.
 */
export type TurnTiming = {
  /** From the prompt being sent to its answer, error or cancel. */
  totalMs: number;
  toolCalls: number;
  /** Time from each call to its answer, summed by tool. */
  toolMs: Record<string, number>;
};

export type TurnTimer = {
  /** A prompt was sent. */
  start: (promptId: string) => void;
  /** The assistant called a tool in that prompt's turn. */
  toolCalled: (promptId: string, toolCallId: string, name: string) => void;
  /** The tab answered that call. */
  toolAnswered: (toolCallId: string) => void;
  /** The turn ended: what it took, or `null` for a prompt not started here. */
  end: (promptId: string) => TurnTiming | null;
};

export function createTurnTimer(now: () => number = Date.now): TurnTimer {
  const turns = new Map<
    string,
    { startedAt: number; toolCalls: number; toolMs: Record<string, number> }
  >();
  const calls = new Map<
    string,
    { promptId: string; name: string; calledAt: number }
  >();
  return {
    start: (promptId) => {
      turns.set(promptId, { startedAt: now(), toolCalls: 0, toolMs: {} });
    },
    toolCalled: (promptId, toolCallId, name) => {
      const turn = turns.get(promptId);
      if (turn === undefined) return;
      turn.toolCalls++;
      calls.set(toolCallId, { promptId, name, calledAt: now() });
    },
    toolAnswered: (toolCallId) => {
      const call = calls.get(toolCallId);
      if (call === undefined) return;
      calls.delete(toolCallId);
      const turn = turns.get(call.promptId);
      if (turn === undefined) return;
      turn.toolMs[call.name] =
        (turn.toolMs[call.name] ?? 0) + (now() - call.calledAt);
    },
    end: (promptId) => {
      const turn = turns.get(promptId);
      if (turn === undefined) return null;
      turns.delete(promptId);
      for (const [id, call] of calls) {
        if (call.promptId === promptId) calls.delete(id);
      }
      return {
        totalMs: now() - turn.startedAt,
        toolCalls: turn.toolCalls,
        toolMs: turn.toolMs,
      };
    },
  };
}

/** One line for the log: the turn, and the tools that took longest. */
export function describeTurnTiming(timing: TurnTiming): string {
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const slowest = Object.entries(timing.toolMs)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, ms]) => `${name} ${seconds(ms)}`);
  return `Code mode turn: ${seconds(timing.totalMs)}, ${timing.toolCalls} tool call${timing.toolCalls === 1 ? "" : "s"}${
    slowest.length > 0 ? ` (${slowest.join(", ")})` : ""
  }`;
}
