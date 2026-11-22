import { Internal } from "@valbuild/core";
import { changesCode as toolChangesCode } from "../proposals/changesCode";
import type { AIClientMessage, AIServerMessage } from "./useAIWebSocket";

/**
 * Where an assistant turn's time went, measured in the tab.
 *
 * A turn is one prompt: the model runs on the content service, and each tool
 * it calls runs here, so a turn is a relay of model -> socket -> tool ->
 * socket -> model. This records that relay from the one place every message
 * of it passes: the assistant's socket (`useAIWebSocket`'s `send` and
 * `onmessage`). Nothing here is recorded per tool, so a tool added, moved or
 * rewritten is measured without a change to it.
 *
 * Every moment of a turn is one of three things, decided by what is
 * outstanding when it passes:
 *
 * - **model**: no tool call is waiting for its result, so the tab waits on
 *   the content service: the model thinking, streaming text, or writing the
 *   arguments of its next tool call. `modelWaitMs` is the silent part of it,
 *   from what the tab sent to the first message back.
 * - **tools**: a tool call arrived and its result has not gone out.
 * - **person**: every tool call outstanding is one that waits on the person
 *   (a question card, a request to turn code mode on). That is neither the
 *   model nor the Studio being slow, so it is kept out of both.
 *
 * The three add up to the turn, with tool calls that overlap counted once.
 *
 * What it cannot see, since it is not on the socket: what a tool does inside
 * (requests are counted in `codeToolRequests.test.tsx`), and how the model's
 * time splits between the provider and the content service.
 *
 * Recorded only while debug is on (`localStorage["val:debug"] = "1"`),
 * decided when a prompt is sent: with it off nothing is recorded, nothing is
 * kept and `__VAL_AI_TURNS__` does not exist. With it on, each turn is
 * printed with `Internal.log.debug` as it ends, `__VAL_AI_TURNS__.turns`
 * holds the last few, `copy(__VAL_AI_TURNS__.text())` copies the last one as
 * text and `copy(__VAL_AI_TURNS__.json())` as JSON, timeline included.
 */
export type AITurnTrace = {
  /** The prompt's id. */
  id: string;
  sessionId: string | null;
  /** Wall clock, for telling turns apart: nothing is measured with it. */
  startedAt: string;
  /** A prompt the person did not type: the publish flow's commit summary. */
  hidden: boolean;
  /**
   * The prompt offered the code tools. Not the same as code mode being on:
   * they are offered on the site and in a proposal with code mode off too,
   * where the ones that write refuse.
   */
  codeTools: boolean;
  proposal: string | null;
  model: string | null;
  /** How it ended; `null` while it runs. */
  end: "response" | "cancelled" | "error" | "disconnected" | null;
  /** Prompt sent to the turn's end. */
  totalMs: number | null;
  /** Prompt sent to the first message of the turn, of any kind. */
  firstMessageMs: number | null;
  /** Prompt sent to the first text the person sees. */
  firstChunkMs: number | null;
  modelMs: number;
  /** The part of `modelMs` spent with nothing arriving. */
  modelWaitMs: number;
  /** Times the tab handed over and waited for the model: the prompt, then once per batch of tool results. */
  modelRoundTrips: number;
  toolMs: number;
  personMs: number;
  toolCalls: number;
  /** By tool name. `ms` adds every call up, so calls that overlap count twice here and once in `toolMs`. */
  tools: Record<string, AITurnToolStats>;
  webSearches: number;
  /** Messages the person sent into the turn while it ran (`ai_steer`). */
  steers: number;
  outputTokens: number | null;
  /** The turn in order, adjacent moments of one kind joined. */
  timeline: AITurnSegment[];
  /** Prompt sent to the last result of a tool call that changed code. */
  lastWriteMs: number | null;
  /** Quick previews that ended after the turn's first write, in order. */
  previews: AITurnPreview[];
  /**
   * Prompt sent to the change being visible: the first quick preview shown
   * that was started after the last write. `null` while none was, which is
   * also the answer where the quick preview is off and only a build shows
   * the change.
   */
  changeVisibleMs: number | null;
  /**
   * That preview started while the last write's tool call was still running,
   * and none started after it: it may have read the proposal just before the
   * files were staged, and then shows the files before the write.
   */
  changeVisibleUncertain: boolean;
  /** The last write's result going out, to that preview being shown. */
  lastWriteToPreviewMs: number | null;
};

export type AITurnToolStats = {
  calls: number;
  ms: number;
  maxMs: number;
  errors: number;
  /** At least one call waited on the person. */
  person: boolean;
};

export type AITurnSegment = {
  kind: "model" | "tools" | "person";
  /** Since the prompt was sent. */
  atMs: number;
  ms: number;
  /** For tools and person: the calls outstanding during it. */
  names?: string[];
};

export type AITurnPreview = {
  status: "shown" | "failed" | "skipped";
  /** Started by itself after a change, rather than asked for. */
  auto: boolean;
  /** Since the prompt was sent, when it ended. */
  atMs: number;
  /**
   * Since the last write's result went out, 0 when it was shown before the
   * tool had answered; `null` when it started before that write, and so
   * shows what was staged before it.
   */
  sinceLastWriteMs: number | null;
  /** It started while the last write's tool call was still running. */
  duringLastWrite: boolean;
  /** How long it ran. */
  ms: number;
  steps: { step: string; ms: number }[];
};

/** How a quick preview ended, as `useQuickPreview` reports it here. */
export type AITurnPreviewReport = {
  status: "shown" | "failed" | "skipped";
  auto: boolean;
  ms: number;
  steps: { step: string; ms: number }[];
};

/**
 * Tools whose call always waits on the person. A call held for the person
 * for another reason (after a web search, before a form is submitted) is
 * marked where it is held: `waitingOnPerson`.
 */
const PERSON_TOOLS = new Set([
  "ask_user_question",
  "request_code_mode",
  "request_web_search",
]);

const KEPT_TURNS = 10;
/** A quick preview this long after a turn ended is not that turn's. */
const PREVIEW_AFTER_END_MS = 120_000;

type OpenCall = {
  turn: OpenTurn;
  name: string;
  at: number;
  person: boolean;
  write: boolean;
};

type OpenTurn = {
  trace: AITurnTrace;
  /** On the trace's clock. */
  start: number;
  /** The last moment accounted for. */
  mark: number;
  endedAt: number | null;
  /** When the last write's result went out, and when its call had arrived. */
  lastWriteAt: number | null;
  lastWriteCallAt: number | null;
  /** When each of `trace.previews` started and ended, by index. */
  previewTimes: { startedAt: number; at: number }[];
  /** Nothing has arrived since the tab last handed over. */
  silent: boolean;
  open: Map<string, OpenCall>;
};

export type AITurnTraceRecorder = {
  /** A message the socket sent. Only one that was really sent. */
  sent(message: AIClientMessage): void;
  /** A message the socket received. */
  received(message: AIServerMessage): void;
  /** The socket closed: the turns running on it will hear nothing more. */
  disconnected(): void;
  /** A tool call is held until the person answers. */
  waitingOnPerson(toolCallId: string): void;
  /** A quick preview ended. */
  preview(report: AITurnPreviewReport): void;
  /** The last few turns, oldest first. */
  turns(): AITurnTrace[];
};

export function createAITurnTrace(options: {
  /** Milliseconds on a clock that only goes forward. */
  now: () => number;
  /** Whether a tool call changes the proposal's code: `changesCode`. */
  changesCode: (name: string, args: Record<string, unknown>) => boolean;
  /** A turn ended, or a preview was added to one that had. */
  onTurn?: (trace: AITurnTrace) => void;
}): AITurnTraceRecorder {
  const { now, changesCode, onTurn } = options;
  const kept: OpenTurn[] = [];
  const running = new Map<string, OpenTurn>();
  const calls = new Map<string, OpenCall>();

  /** Account for the time since the turn's last event, as what it was. */
  const advance = (turn: OpenTurn, at: number) => {
    const ms = at - turn.mark;
    const open = Array.from(turn.open.values());
    const kind: AITurnSegment["kind"] =
      open.length === 0
        ? "model"
        : open.every((call) => call.person)
          ? "person"
          : "tools";
    const trace = turn.trace;
    if (kind === "model") {
      trace.modelMs += ms;
      if (turn.silent) trace.modelWaitMs += ms;
    } else if (kind === "tools") {
      trace.toolMs += ms;
    } else {
      trace.personMs += ms;
    }
    const names =
      kind === "model"
        ? undefined
        : Array.from(new Set(open.map((call) => call.name))).sort();
    const last = trace.timeline[trace.timeline.length - 1];
    if (
      last !== undefined &&
      last.kind === kind &&
      (last.names ?? []).join() === (names ?? []).join()
    ) {
      last.ms += ms;
    } else if (ms > 0) {
      trace.timeline.push({
        kind,
        atMs: turn.mark - turn.start,
        ms,
        ...(names !== undefined ? { names } : {}),
      });
    }
    turn.mark = at;
  };

  /**
   * Which of the turn's quick previews show its last write, now that a
   * preview or a write was added.
   *
   * A quick preview shows the last write when it STARTED after that write's
   * call arrived: it reads what is staged as it starts, and the staging is
   * made inside the call. One started before the call shows what was staged
   * before it. One started inside the call may have read just before the
   * staging landed: it is believed only until one started after the answer
   * is shown, and the trace says so (`changeVisibleUncertain`). Whoever
   * caused a preview, one started after the write shows the write, so the
   * first such one is when the change was visible.
   */
  const placePreviews = (turn: OpenTurn) => {
    const { trace, lastWriteAt, lastWriteCallAt } = turn;
    let sure: AITurnPreview | null = null;
    let unsure: AITurnPreview | null = null;
    for (const [index, preview] of trace.previews.entries()) {
      const times = turn.previewTimes[index];
      const ofLastWrite =
        times !== undefined &&
        lastWriteAt !== null &&
        lastWriteCallAt !== null &&
        times.startedAt >= lastWriteCallAt;
      preview.sinceLastWriteMs =
        ofLastWrite && lastWriteAt !== null
          ? Math.max(0, times.at - lastWriteAt)
          : null;
      preview.duringLastWrite =
        ofLastWrite && lastWriteAt !== null && times.startedAt < lastWriteAt;
      if (preview.status !== "shown" || !ofLastWrite) continue;
      if (preview.duringLastWrite) unsure ??= preview;
      else sure ??= preview;
    }
    // One started after the write was answered is of it for certain. One
    // started during it is believed only while no such one was shown.
    const shown: AITurnPreview | null = sure ?? unsure;
    trace.changeVisibleMs = shown?.atMs ?? null;
    trace.lastWriteToPreviewMs = shown?.sinceLastWriteMs ?? null;
    trace.changeVisibleUncertain = shown !== null && sure === null;
  };

  const end = (turn: OpenTurn, how: NonNullable<AITurnTrace["end"]>) => {
    const at = now();
    advance(turn, at);
    turn.endedAt = at;
    turn.trace.end = how;
    turn.trace.totalMs = at - turn.start;
    running.delete(turn.trace.id);
    for (const [toolCallId, call] of Array.from(calls)) {
      if (call.turn === turn) calls.delete(toolCallId);
    }
    turn.open.clear();
    onTurn?.(turn.trace);
  };

  return {
    sent(message) {
      const at = now();
      if (message.type === "ai_prompt") {
        const tools = message.agents.flatMap((agent) => agent.tools ?? []);
        const turn: OpenTurn = {
          trace: {
            id: message.id,
            sessionId: message.sessionId ?? null,
            startedAt: new Date().toISOString(),
            hidden: message.hidden === true,
            codeTools: tools.some((tool) => tool.name === "edit_file"),
            proposal: message.proposal ?? null,
            model: message.agents[0]?.model.model ?? null,
            end: null,
            totalMs: null,
            firstMessageMs: null,
            firstChunkMs: null,
            modelMs: 0,
            modelWaitMs: 0,
            modelRoundTrips: 1,
            toolMs: 0,
            personMs: 0,
            toolCalls: 0,
            tools: {},
            webSearches: 0,
            steers: 0,
            outputTokens: null,
            timeline: [],
            lastWriteMs: null,
            previews: [],
            changeVisibleMs: null,
            changeVisibleUncertain: false,
            lastWriteToPreviewMs: null,
          },
          start: at,
          mark: at,
          endedAt: null,
          lastWriteAt: null,
          lastWriteCallAt: null,
          previewTimes: [],
          silent: true,
          open: new Map(),
        };
        running.set(message.id, turn);
        kept.push(turn);
        if (kept.length > KEPT_TURNS) {
          // One that never ended is let go with its calls.
          const dropped = kept.shift();
          if (dropped !== undefined && dropped.endedAt === null) {
            running.delete(dropped.trace.id);
            for (const toolCallId of Array.from(dropped.open.keys())) {
              calls.delete(toolCallId);
            }
          }
        }
        return;
      }
      if (message.type === "ai_steer") {
        const turn = running.get(message.id);
        if (turn !== undefined) turn.trace.steers += 1;
        return;
      }
      if (message.type === "ai_tool_result") {
        const call = calls.get(message.toolCallId);
        if (call === undefined) return;
        const turn = call.turn;
        advance(turn, at);
        calls.delete(message.toolCallId);
        turn.open.delete(message.toolCallId);
        const ms = at - call.at;
        const stats = (turn.trace.tools[call.name] ??= {
          calls: 0,
          ms: 0,
          maxMs: 0,
          errors: 0,
          person: false,
        });
        stats.calls += 1;
        stats.ms += ms;
        stats.maxMs = Math.max(stats.maxMs, ms);
        if (message.isError === true) stats.errors += 1;
        if (call.person) stats.person = true;
        if (call.write && message.isError !== true) {
          turn.lastWriteAt = at;
          turn.lastWriteCallAt = call.at;
          turn.trace.lastWriteMs = at - turn.start;
          // What was shown before this write does not show it.
          placePreviews(turn);
        }
        if (turn.open.size === 0) {
          // The last result of the batch: the model has the turn again.
          turn.trace.modelRoundTrips += 1;
          turn.silent = true;
        }
      }
    },

    received(message) {
      if (!("id" in message)) return;
      // The service saying what became of a steer is not the model answering.
      if (message.type === "ai_steer_status") return;
      const turn = running.get(message.id);
      if (turn === undefined) return;
      const at = now();
      advance(turn, at);
      turn.silent = false;
      const trace = turn.trace;
      trace.firstMessageMs ??= at - turn.start;
      if (message.type === "ai_streaming") {
        trace.firstChunkMs ??= at - turn.start;
      } else if (message.type === "ai_tool_call") {
        const args = message.arguments;
        const call: OpenCall = {
          turn,
          name: message.name,
          at,
          person: PERSON_TOOLS.has(message.name),
          write: changesCode(
            message.name,
            typeof args === "object" && args !== null && !Array.isArray(args)
              ? { ...args }
              : {},
          ),
        };
        calls.set(message.toolCallId, call);
        turn.open.set(message.toolCallId, call);
        trace.toolCalls += 1;
      } else if (message.type === "ai_web_search") {
        trace.webSearches += 1;
      } else if (message.type === "ai_usage") {
        trace.outputTokens = message.outputTokens;
      } else if (message.type === "ai_response") {
        trace.sessionId = message.sessionId;
        trace.outputTokens =
          message.metadata?.outputTokens ?? trace.outputTokens;
        end(turn, "response");
      } else if (message.type === "ai_cancelled") {
        end(turn, "cancelled");
      } else if (message.type === "ai_error") {
        end(turn, "error");
      }
    },

    disconnected() {
      for (const turn of Array.from(running.values())) {
        end(turn, "disconnected");
      }
    },

    waitingOnPerson(toolCallId) {
      const call = calls.get(toolCallId);
      if (call === undefined || call.person) return;
      advance(call.turn, now());
      call.person = true;
    },

    preview(report) {
      const at = now();
      // The last turn the person asked for: when it wrote code, or is
      // writing it now, its change is what a quick preview shows.
      const turn = [...kept].reverse().find((each) => !each.trace.hidden);
      if (turn === undefined) return;
      const writing = Array.from(turn.open.values()).some((c) => c.write);
      if (turn.lastWriteAt === null && !writing) return;
      const trace = turn.trace;
      if (turn.endedAt !== null) {
        if (at - turn.endedAt > PREVIEW_AFTER_END_MS) return;
        // The turn is over and its change is on screen: a later quick
        // preview is somebody else's change, not more of this turn.
        if (trace.changeVisibleMs !== null && !trace.changeVisibleUncertain) {
          return;
        }
      }
      trace.previews.push({
        status: report.status,
        auto: report.auto,
        atMs: at - turn.start,
        sinceLastWriteMs: null,
        duringLastWrite: false,
        ms: report.ms,
        steps: report.steps,
      });
      turn.previewTimes.push({ startedAt: at - report.ms, at });
      const before = `${trace.changeVisibleMs} ${trace.changeVisibleUncertain}`;
      placePreviews(turn);
      // Told again when the turn is over: its line was printed without this.
      if (
        turn.endedAt !== null &&
        before !== `${trace.changeVisibleMs} ${trace.changeVisibleUncertain}`
      ) {
        onTurn?.(trace);
      }
    },

    turns() {
      return kept.map((turn) => turn.trace);
    },
  };
}

const seconds = (ms: number | null): string =>
  ms === null ? "-" : `${(ms / 1000).toFixed(2)}s`;

/** A turn as lines a person can read and paste. */
export function formatAITurnTrace(trace: AITurnTrace): string {
  const tools = Object.entries(trace.tools)
    .sort(([, a], [, b]) => b.ms - a.ms)
    .map(
      ([name, stats]) =>
        `    ${name}: ${stats.calls} call${stats.calls === 1 ? "" : "s"}, ${seconds(stats.ms)} (max ${seconds(stats.maxMs)})` +
        (stats.errors > 0 ? `, ${stats.errors} failed` : "") +
        (stats.person
          ? ", waited on the person (all of a held call counts as theirs, what ran after they answered included)"
          : ""),
    );
  const previews = trace.previews.map(
    (preview) =>
      `    ${preview.status}${preview.auto ? " (by itself)" : " (asked for)"} at ${seconds(preview.atMs)}, ran ${seconds(preview.ms)}` +
      (preview.sinceLastWriteMs !== null
        ? `, ${seconds(preview.sinceLastWriteMs)} after the last write`
        : ", before the last write") +
      (preview.steps.length > 0
        ? `: ${preview.steps.map((step) => `${step.step} ${seconds(step.ms)}`).join(", ")}`
        : ""),
  );
  return [
    `assistant turn ${trace.id}: ${trace.end ?? "running"}, ${seconds(trace.totalMs)}` +
      (trace.hidden ? " (hidden)" : "") +
      (trace.codeTools ? " (code tools)" : "") +
      (trace.proposal !== null ? ` in proposal ${trace.proposal}` : "") +
      (trace.model !== null ? `, ${trace.model}` : ""),
    `  first message ${seconds(trace.firstMessageMs)}, first text ${seconds(trace.firstChunkMs)}`,
    `  model ${seconds(trace.modelMs)} over ${trace.modelRoundTrips} round trip${trace.modelRoundTrips === 1 ? "" : "s"} (${seconds(trace.modelWaitMs)} of it silent)`,
    `  tools ${seconds(trace.toolMs)} over ${trace.toolCalls} call${trace.toolCalls === 1 ? "" : "s"}` +
      (trace.personMs > 0
        ? `, waiting on the person ${seconds(trace.personMs)}`
        : "") +
      (trace.steers > 0 ? `, ${trace.steers} steered in` : ""),
    ...tools,
    trace.lastWriteMs === null
      ? "  no code written"
      : `  last write at ${seconds(trace.lastWriteMs)}, change visible at ${seconds(trace.changeVisibleMs)} (${seconds(trace.lastWriteToPreviewMs)} after it)` +
        (trace.changeVisibleUncertain
          ? " -- UNCERTAIN: that preview started while the write was being staged, and may show the files before it"
          : ""),
    ...previews,
  ].join("\n");
}

/** What `__VAL_AI_TURNS__` is in the console. */
export type AITurnTraceConsole = {
  /** The last few turns, oldest first. */
  readonly turns: AITurnTrace[];
  last(): AITurnTrace | null;
  /** A turn (the last, or the nth from the end) as text: `copy(__VAL_AI_TURNS__.text())`. */
  text(fromEnd?: number): string;
  /** The same turn as JSON, timeline included: `copy(__VAL_AI_TURNS__.json())`. */
  json(fromEnd?: number): string;
};

let studioTrace: AITurnTraceRecorder | null = null;

function startStudioTrace(): AITurnTraceRecorder {
  const recorder = createAITurnTrace({
    now: () => performance.now(),
    changesCode: toolChangesCode,
    onTurn: (trace) => {
      Internal.log.debug(formatAITurnTrace(trace), trace);
    },
  });
  const nth = (fromEnd = 0): AITurnTrace | null => {
    const turns = recorder.turns();
    return turns[turns.length - 1 - fromEnd] ?? null;
  };
  const forConsole: AITurnTraceConsole = {
    get turns() {
      return recorder.turns();
    },
    last: () => nth(),
    text: (fromEnd) => {
      const trace = nth(fromEnd);
      return trace === null
        ? "No assistant turn yet."
        : formatAITurnTrace(trace);
    },
    json: (fromEnd) => JSON.stringify(nth(fromEnd), null, 2),
  };
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "__VAL_AI_TURNS__", {
      value: forConsole,
      configurable: true,
    });
  }
  return recorder;
}

function stopStudioTrace(): void {
  studioTrace = null;
  if (typeof window !== "undefined" && "__VAL_AI_TURNS__" in window) {
    delete window.__VAL_AI_TURNS__;
  }
}

declare global {
  interface Window {
    __VAL_AI_TURNS__?: AITurnTraceConsole;
  }
}

/**
 * The Studio's own trace, as the assistant's socket feeds it: one per page,
 * since one socket carries every turn of it.
 *
 * Whether to record is decided when a prompt is sent, by whether debug is
 * on. Off: what was kept is let go, `__VAL_AI_TURNS__` is removed, and every
 * message until the next prompt costs one `null` check.
 */
export const studioAITurnTrace = {
  /** A message the socket sent. */
  sent(message: AIClientMessage): void {
    if (message.type === "ai_prompt") {
      if (!Internal.isDebugEnabled()) stopStudioTrace();
      else studioTrace ??= startStudioTrace();
    }
    studioTrace?.sent(message);
  },
  /** A message the socket received. */
  received(message: AIServerMessage): void {
    studioTrace?.received(message);
  },
  /** The socket closed. */
  disconnected(): void {
    studioTrace?.disconnected();
  },
};

/**
 * A quick preview ended: told from `useQuickPreview`, which is not on the
 * socket. Nothing while no turn is being recorded.
 */
export function reportQuickPreviewToTurnTrace(
  report: AITurnPreviewReport,
): void {
  studioTrace?.preview(report);
}

/** A tool call is held for the person: told from where it is held. */
export function reportWaitingOnPerson(toolCallId: string): void {
  studioTrace?.waitingOnPerson(toolCallId);
}
