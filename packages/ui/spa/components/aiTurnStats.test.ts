import {
  addStreamedText,
  elapsedMs,
  endTurn,
  formatElapsed,
  formatTokens,
  outputTokensOf,
  reportOutputTokens,
  startTurn,
  syncPause,
  turnPhaseOf,
} from "./aiTurnStats";

describe("the turn clock", () => {
  it("runs from the send, not from the first chunk", () => {
    expect(elapsedMs(startTurn(1_000), 5_000)).toBe(4_000);
  });

  it("stops when the turn ends", () => {
    const ended = endTurn(startTurn(0), 3_000);
    expect(elapsedMs(ended, 60_000)).toBe(3_000);
  });

  it("leaves out the time a question card was open", () => {
    let stats = startTurn(0);
    stats = syncPause(stats, true, 2_000);
    expect(elapsedMs(stats, 50_000)).toBe(2_000);
    stats = syncPause(stats, false, 50_000);
    expect(elapsedMs(stats, 51_000)).toBe(3_000);
  });

  it("is not paused twice by a second report of the same open card", () => {
    let stats = syncPause(startTurn(0), true, 2_000);
    stats = syncPause(stats, true, 9_000);
    expect(stats.pausedAt).toBe(2_000);
  });

  // An error while the card is open ends the turn mid-pause; answering the
  // card afterwards must not move a clock that has already stopped.
  it("ends correctly while paused, and ignores a resume after that", () => {
    let stats = syncPause(startTurn(0), true, 2_000);
    stats = endTurn(stats, 10_000);
    expect(elapsedMs(stats, 10_000)).toBe(2_000);
    stats = syncPause(stats, false, 30_000);
    expect(elapsedMs(stats, 40_000)).toBe(2_000);
  });
});

describe("output tokens", () => {
  it("shows nothing until something has been produced", () => {
    expect(outputTokensOf(startTurn(0))).toBeNull();
  });

  it("estimates from streamed text until the server reports", () => {
    const stats = addStreamedText(startTurn(0), "x".repeat(10));
    expect(outputTokensOf(stats)).toEqual({ count: 3, estimated: true });
  });

  it("prefers the server's count over the estimate, even a smaller one", () => {
    let stats = addStreamedText(startTurn(0), "x".repeat(4_000));
    stats = reportOutputTokens(stats, 120, true);
    expect(outputTokensOf(stats)).toEqual({ count: 120, estimated: false });
  });

  it("carries the server's own estimate as an estimate", () => {
    const stats = reportOutputTokens(startTurn(0), 800, false);
    expect(outputTokensOf(stats)).toEqual({ count: 800, estimated: true });
  });

  it("takes the exact count the turn ended with", () => {
    let stats = reportOutputTokens(startTurn(0), 800, false);
    stats = endTurn(stats, 1_000, { outputTokens: 912 });
    expect(outputTokensOf(stats)).toEqual({ count: 912, estimated: false });
  });

  it("ignores a report that arrives after the turn ended", () => {
    let stats = endTurn(startTurn(0), 1_000, { outputTokens: 912 });
    stats = reportOutputTokens(stats, 5, false);
    expect(outputTokensOf(stats)).toEqual({ count: 912, estimated: false });
  });

  it("shows no count for a turn that produced nothing", () => {
    const stats = endTurn(startTurn(0), 1_000, { outputTokens: 0 });
    expect(outputTokensOf(stats)).toBeNull();
  });
});

describe("turnPhaseOf", () => {
  const streaming = {
    status: "streaming" as const,
    stopped: false,
    waitingOnUser: false,
    hasRunningTool: false,
    hasText: false,
  };

  it("thinks before any text", () => {
    expect(turnPhaseOf(streaming)).toBe("thinking");
  });
  it("writes once text arrives", () => {
    expect(turnPhaseOf({ ...streaming, hasText: true })).toBe("writing");
  });
  it("works while a tool runs, text or not", () => {
    expect(
      turnPhaseOf({ ...streaming, hasText: true, hasRunningTool: true }),
    ).toBe("working");
  });
  it("waits while a question card is open", () => {
    expect(
      turnPhaseOf({ ...streaming, waitingOnUser: true, hasRunningTool: true }),
    ).toBe("waiting");
  });
  it("tells done, stopped and failed apart", () => {
    expect(turnPhaseOf({ ...streaming, status: "complete" })).toBe("done");
    expect(
      turnPhaseOf({ ...streaming, status: "complete", stopped: true }),
    ).toBe("stopped");
    expect(turnPhaseOf({ ...streaming, status: "error" })).toBe("failed");
  });
});

describe("formatting", () => {
  it.each([
    [0, "0s"],
    [59_999, "59s"],
    [60_000, "1m 00s"],
    [65_000, "1m 05s"],
    [3_725_000, "62m 05s"],
  ])("formatElapsed(%d) is %s", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });

  it.each([
    [0, "0"],
    [999, "999"],
    [1_000, "1.0k"],
    [2_140, "2.1k"],
    [9_949, "9.9k"],
    [9_950, "10k"],
    [123_456, "123k"],
  ])("formatTokens(%d) is %s", (tokens, text) => {
    expect(formatTokens(tokens)).toBe(text);
  });
});
