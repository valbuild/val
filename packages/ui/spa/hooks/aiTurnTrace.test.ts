import {
  createAITurnTrace,
  formatAITurnTrace,
  type AITurnTrace,
} from "./aiTurnTrace";
import type { AIPromptMessage } from "./useAIWebSocket";

/*
 * The clock is the edge: every message below is one the socket sends or
 * receives, handed over as `useAIWebSocket` hands it.
 */
function trace() {
  let at = 0;
  const told: AITurnTrace[] = [];
  const recorder = createAITurnTrace({
    now: () => at,
    changesCode: (name) => name === "edit_file" || name === "write_files",
    onTurn: (turn) => told.push(turn),
  });
  return {
    recorder,
    told,
    after: (ms: number) => {
      at += ms;
    },
    last: () => {
      const turns = recorder.turns();
      return turns[turns.length - 1];
    },
  };
}

const prompt = (
  id: string,
  over: Partial<AIPromptMessage> = {},
): AIPromptMessage => ({
  type: "ai_prompt",
  id,
  message: "Make the heading red",
  agents: [
    {
      id: "val",
      systemPrompt: "",
      model: { provider: "anthropic", model: "claude-sonnet-5-5" },
      tools: [],
    },
  ],
  ...over,
});
const codeTools = [
  {
    name: "edit_file",
    description: "",
    parameters: { type: "object" as const, properties: {} },
  },
];
const call = (id: string, toolCallId: string, name: string) => ({
  type: "ai_tool_call" as const,
  id,
  toolCallId,
  name,
  arguments: {},
});
const result = (toolCallId: string, isError = false) => ({
  type: "ai_tool_result" as const,
  toolCallId,
  result: {},
  ...(isError ? { isError: true } : {}),
});
const response = (id: string) => ({
  type: "ai_response" as const,
  id,
  sessionId: "s1",
  response: "Done.",
});

describe("an assistant turn's trace", () => {
  test("model time, tool time and round trips add up to the turn", () => {
    const { recorder, after, last, told } = trace();
    recorder.sent(prompt("p1"));
    after(900);
    recorder.received({ type: "ai_streaming", id: "p1", chunk: "Looking." });
    after(300);
    recorder.received(call("p1", "t1", "read_file"));
    after(200);
    recorder.sent(result("t1"));
    after(1500);
    recorder.received(call("p1", "t2", "edit_file"));
    after(4000);
    recorder.sent(result("t2"));
    after(700);
    recorder.received({ type: "ai_streaming", id: "p1", chunk: "Done." });
    after(100);
    recorder.received(response("p1"));

    const turn = last();
    expect(turn.end).toBe("response");
    expect(turn.totalMs).toBe(7700);
    expect(turn.firstMessageMs).toBe(900);
    expect(turn.firstChunkMs).toBe(900);
    expect(turn.modelMs).toBe(900 + 300 + 1500 + 700 + 100);
    expect(turn.modelWaitMs).toBe(900 + 1500 + 700);
    expect(turn.modelRoundTrips).toBe(3);
    expect(turn.toolMs).toBe(4200);
    expect(turn.personMs).toBe(0);
    expect(turn.toolCalls).toBe(2);
    expect(turn.tools).toEqual({
      read_file: { calls: 1, ms: 200, maxMs: 200, errors: 0, person: false },
      edit_file: { calls: 1, ms: 4000, maxMs: 4000, errors: 0, person: false },
    });
    expect(turn.modelMs + turn.toolMs + turn.personMs).toBe(turn.totalMs);
    expect(turn.lastWriteMs).toBe(900 + 300 + 200 + 1500 + 4000);
    expect(turn.timeline.map((each) => [each.kind, each.ms])).toEqual([
      ["model", 1200],
      ["tools", 200],
      ["model", 1500],
      ["tools", 4000],
      ["model", 800],
    ]);
    expect(told).toEqual([turn]);
  });

  test("tool calls of one reply overlap: counted once in the turn, each in its own name, and one round trip", () => {
    const { recorder, after, last } = trace();
    recorder.sent(prompt("p1"));
    after(1000);
    recorder.received(call("p1", "t1", "read_file"));
    recorder.received(call("p1", "t2", "read_file"));
    after(300);
    recorder.sent(result("t1"));
    after(200);
    recorder.sent(result("t2", true));
    after(500);
    recorder.received(response("p1"));
    const turn = last();
    expect(turn.toolMs).toBe(500);
    expect(turn.tools["read_file"]).toEqual({
      calls: 2,
      ms: 800,
      maxMs: 500,
      errors: 1,
      person: false,
    });
    expect(turn.modelRoundTrips).toBe(2);
    expect(turn.modelMs + turn.toolMs).toBe(turn.totalMs);
  });

  test("waiting on the person is neither model time nor tool time", () => {
    const { recorder, after, last } = trace();
    recorder.sent(prompt("p1"));
    after(1000);
    recorder.received(call("p1", "q1", "ask_user_question"));
    after(60_000);
    recorder.sent(result("q1"));
    after(1000);
    // A call the Studio holds for the person after it arrived as any other.
    recorder.received(call("p1", "t1", "interact_page"));
    after(200);
    recorder.waitingOnPerson("t1");
    after(30_000);
    recorder.sent(result("t1"));
    after(500);
    recorder.received(response("p1"));
    const turn = last();
    expect(turn.personMs).toBe(90_000);
    expect(turn.toolMs).toBe(200);
    expect(turn.modelMs).toBe(2500);
    expect(turn.tools["ask_user_question"]?.person).toBe(true);
    expect(turn.tools["interact_page"]?.person).toBe(true);
  });

  test("a turn ends when it is cancelled, fails, or its socket closes", () => {
    const { recorder, after, told } = trace();
    recorder.sent(prompt("p1"));
    after(100);
    recorder.sent({ type: "ai_cancel", id: "p1" });
    after(50);
    recorder.received({ type: "ai_cancelled", id: "p1" });
    recorder.sent(prompt("p2"));
    after(10);
    recorder.received({
      type: "ai_error",
      id: "p2",
      code: "internal_error",
      message: "No",
    });
    recorder.sent(prompt("p3"));
    after(400);
    recorder.received(call("p3", "t1", "edit_file"));
    after(100);
    recorder.disconnected();
    // What the tool answers after the socket is gone is nobody's.
    recorder.sent(result("t1"));
    expect(told.map((turn) => [turn.id, turn.end, turn.totalMs])).toEqual([
      ["p1", "cancelled", 150],
      ["p2", "error", 10],
      ["p3", "disconnected", 500],
    ]);
    expect(told[2].tools).toEqual({});
  });

  test("two turns on one socket are told apart by the prompt's id", () => {
    const { recorder, after } = trace();
    recorder.sent(prompt("chat"));
    after(100);
    recorder.sent(prompt("summary", { hidden: true }));
    after(100);
    recorder.received(call("chat", "t1", "read_file"));
    after(100);
    recorder.received(response("summary"));
    after(100);
    recorder.sent(result("t1"));
    after(100);
    recorder.received(response("chat"));
    // Somebody else's turn in a watched chat is not this tab's.
    recorder.received({
      type: "ai_watched",
      sessionId: "s2",
      event: { type: "ai_streaming", id: "chat", chunk: "x" },
    });
    const [chat, summary] = recorder.turns();
    expect([chat.hidden, chat.totalMs, chat.toolMs, chat.modelMs]).toEqual([
      false,
      500,
      200,
      300,
    ]);
    expect([summary.hidden, summary.totalMs, summary.toolCalls]).toEqual([
      true,
      200,
      0,
    ]);
  });

  test("the change is visible when a quick preview is shown after the last write", () => {
    const { recorder, after, last, told } = trace();
    recorder.sent(
      prompt("p1", {
        proposal: "spring",
        agents: [{ ...prompt("x").agents[0], tools: codeTools }],
      }),
    );
    after(1000);
    recorder.received(call("p1", "t1", "edit_file"));
    after(2000);
    recorder.sent(result("t1"));
    after(3000);
    // Shown, but of the first write only: the second is not on screen yet.
    recorder.preview({ status: "shown", auto: true, ms: 2500, steps: [] });
    expect(last().changeVisibleMs).toBe(6000);
    recorder.received(call("p1", "t2", "edit_file"));
    after(2000);
    recorder.sent(result("t2"));
    expect(last().changeVisibleMs).toBeNull();
    after(500);
    // One that started before the second write was asked for: not of it.
    recorder.preview({ status: "shown", auto: true, ms: 3000, steps: [] });
    expect(last().changeVisibleMs).toBeNull();
    recorder.received(response("p1"));
    expect(told).toHaveLength(1);
    after(4000);
    recorder.preview({
      status: "shown",
      auto: true,
      ms: 3000,
      steps: [{ step: "Building on Val Build", ms: 2800 }],
    });
    const turn = last();
    expect(turn.codeTools).toBe(true);
    expect(turn.totalMs).toBe(8500);
    expect(turn.lastWriteMs).toBe(8000);
    expect(turn.changeVisibleMs).toBe(12_500);
    expect(turn.lastWriteToPreviewMs).toBe(4500);
    // Counted from the turn's LAST write: the first showed an earlier one.
    expect(turn.previews.map((each) => each.sinceLastWriteMs)).toEqual([
      null,
      null,
      4500,
    ]);
    // Told again: the line printed at the turn's end did not have it.
    expect(told).toHaveLength(2);
    expect(formatAITurnTrace(turn)).toContain(
      "last write at 8.00s, change visible at 12.50s (4.50s after it)",
    );
  });

  test("a quick preview shown while the write's tool was still answering counts from 0", () => {
    const { recorder, after, last } = trace();
    recorder.sent(prompt("p1"));
    after(1000);
    recorder.received(call("p1", "t1", "write_files"));
    // The staging lands, a quick preview starts and is shown, all while the
    // tool still waits for the tab to evaluate the staged code.
    after(500);
    after(2000);
    recorder.preview({ status: "shown", auto: true, ms: 2000, steps: [] });
    after(4000);
    recorder.sent(result("t1"));
    // Asked again once the tool answers: shown already.
    recorder.preview({ status: "skipped", auto: true, ms: 0, steps: [] });
    after(100);
    recorder.received(response("p1"));
    expect(last().previews.map((each) => each.status)).toEqual([
      "shown",
      "skipped",
    ]);
    expect(last().lastWriteMs).toBe(7500);
    expect(last().changeVisibleMs).toBe(3500);
    expect(last().lastWriteToPreviewMs).toBe(0);
    // It started inside the write's call: believed, and said to be unsure.
    expect(last().changeVisibleUncertain).toBe(true);
    expect(formatAITurnTrace(last())).toContain("UNCERTAIN");
    // One started after the answer settles it, and is the turn's last.
    after(1000);
    recorder.preview({ status: "shown", auto: true, ms: 900, steps: [] });
    expect(last().changeVisibleUncertain).toBe(false);
    expect(last().changeVisibleMs).toBe(8600);
    after(5000);
    recorder.preview({ status: "shown", auto: false, ms: 900, steps: [] });
    expect(last().previews).toHaveLength(3);
  });

  test("a quick preview is not a turn's when the turn wrote nothing, or a later turn was asked", () => {
    const { recorder, after, last } = trace();
    recorder.sent(prompt("p1"));
    after(100);
    recorder.received(call("p1", "t1", "edit_file"));
    after(100);
    recorder.sent(result("t1", true));
    recorder.received(response("p1"));
    recorder.preview({ status: "shown", auto: false, ms: 1, steps: [] });
    expect(last().previews).toEqual([]);
    expect(last().lastWriteMs).toBeNull();
    expect(formatAITurnTrace(last())).toContain("no code written");
  });

  test("a message steered into the turn is counted, and what became of it is not the model answering", () => {
    const { recorder, after, last } = trace();
    recorder.sent(prompt("p1"));
    after(500);
    recorder.sent({
      type: "ai_steer",
      id: "p1",
      sessionId: "s1",
      steerId: "x",
      message: "Blue, not red",
    });
    recorder.received({
      type: "ai_steer_status",
      id: "p1",
      steerId: "x",
      status: "accepted",
    });
    after(500);
    recorder.received(response("p1"));
    expect(last().steers).toBe(1);
    expect(last().firstMessageMs).toBe(1000);
    expect(last().modelWaitMs).toBe(1000);
  });

  test("the content service's own timings are kept beside the tab's, and are not the model answering", () => {
    const { recorder, after, last } = trace();
    recorder.sent(prompt("p1", { reportTimings: true }));
    after(2000);
    recorder.received(call("p1", "t1", "read_file"));
    recorder.received({
      type: "ai_step_timing",
      id: "p1",
      kind: "reply",
      step: 1,
      totalMs: 1900,
      firstByteMs: 1200,
      firstOutputMs: 1500,
      inputTokens: 9000,
      cacheReadTokens: 8000,
      outputTokens: 40,
      toolCalls: ["read_file"],
    });
    after(100);
    recorder.sent(result("t1"));
    after(50);
    // Arrives while the tab waits for the model: the wait goes on.
    recorder.received({
      type: "ai_step_timing",
      id: "p1",
      kind: "tools",
      step: 1,
      totalMs: 140,
      afterMs: 3,
      toolCalls: ["read_file"],
    });
    after(950);
    recorder.received({
      type: "ai_step_timing",
      id: "p1",
      kind: "reply",
      step: 2,
      totalMs: 900,
      inputTokens: 9100,
      cacheReadTokens: 9000,
    });
    recorder.received(response("p1"));
    const turn = last();
    expect(turn.modelWaitMs).toBe(3000);
    expect(turn.modelMs).toBe(3000);
    expect(turn.replies.map((reply) => [reply.step, reply.totalMs])).toEqual([
      [1, 1900],
      [2, 900],
    ]);
    expect(turn.replies[1].firstByteMs).toBeNull();
    expect(turn.toolRounds).toEqual([
      { step: 1, totalMs: 140, afterMs: 3, toolCalls: ["read_file"] },
    ]);
    const text = formatAITurnTrace(turn);
    expect(text).toContain(
      "on the server: model 2.80s over 2 replies (1.20s to first byte, 1.50s to first output), 18100 input tokens (17000 from cache), 0.20s of the tab's model time is not the model",
    );
    expect(text).toContain(
      "reply 1: 1.90s, first byte 1.20s, first output 1.50s, 9000 in (8000 cached), 40 out -> read_file",
    );
  });

  test("only the last few turns are kept", () => {
    const { recorder } = trace();
    for (let i = 0; i < 14; i++) {
      recorder.sent(prompt(`p${i}`));
      recorder.received(response(`p${i}`));
    }
    expect(recorder.turns().map((turn) => turn.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `p${i + 4}`),
    );
  });
});
