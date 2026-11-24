import { createTurnTimer, describeTurnTiming } from "./turnTiming";

describe("how long a code mode turn takes", () => {
  test("from the prompt to its answer, with the time spent waiting on each tool", () => {
    let now = 0;
    const timer = createTurnTimer(() => now);
    timer.start("p1");
    now = 1_000;
    timer.toolCalled("p1", "t1", "edit_file");
    now = 1_500;
    timer.toolAnswered("t1");
    timer.toolCalled("p1", "t2", "typecheck");
    now = 31_500;
    timer.toolAnswered("t2");
    timer.toolCalled("p1", "t3", "edit_file");
    now = 32_000;
    timer.toolAnswered("t3");
    now = 40_000;
    const timing = timer.end("p1");
    expect(timing).toEqual({
      totalMs: 40_000,
      toolCalls: 3,
      toolMs: { edit_file: 1_000, typecheck: 30_000 },
    });
    expect(timing && describeTurnTiming(timing)).toBe(
      "Code mode turn: 40.0 s, 3 tool calls (typecheck 30.0 s, edit_file 1.0 s)",
    );
  });

  test("a prompt not timed here, and calls of other prompts, are not counted", () => {
    let now = 0;
    const timer = createTurnTimer(() => now);
    timer.toolCalled("elsewhere", "t1", "read_file");
    timer.toolAnswered("t1");
    expect(timer.end("elsewhere")).toBeNull();

    timer.start("p1");
    timer.toolCalled("p1", "t2", "build_proposal");
    now = 5_000;
    // Ended (cancelled) before the build answered: the call is not left behind.
    expect(timer.end("p1")).toEqual({
      totalMs: 5_000,
      toolCalls: 1,
      toolMs: {},
    });
    timer.toolAnswered("t2");
    expect(timer.end("p1")).toBeNull();
  });
});
