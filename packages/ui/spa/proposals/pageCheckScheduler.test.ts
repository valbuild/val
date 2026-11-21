import {
  createPageCheckScheduler,
  PAGE_CHECK_QUIET_MS,
  PAGE_CHECKS_PER_MESSAGE,
  type PageCheckRequest,
} from "./pageCheckScheduler";

describe("when the page check runs", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const scheduler = () => {
    const started: PageCheckRequest[] = [];
    const check = createPageCheckScheduler((request) => started.push(request));
    return { check, started };
  };

  test("a run of changes is checked once, when the turn ends", () => {
    const { check, started } = scheduler();
    check.codeChanged();
    check.codeChanged();
    check.codeChanged();
    expect(started).toEqual([]);
    check.turnEnded();
    expect(started).toEqual([{ reason: "turn-ended", focus: null }]);
    // The timer the changes set does not go off as well.
    jest.advanceTimersByTime(PAGE_CHECK_QUIET_MS);
    expect(started).toHaveLength(1);
  });

  test("a long turn is checked after the changes stop, without waiting for its end", () => {
    const { check, started } = scheduler();
    check.codeChanged();
    jest.advanceTimersByTime(PAGE_CHECK_QUIET_MS - 1);
    check.codeChanged();
    jest.advanceTimersByTime(PAGE_CHECK_QUIET_MS - 1);
    expect(started).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(started).toEqual([{ reason: "quiet", focus: null }]);
    check.finished();
    // Checked: the end of the turn starts nothing more.
    check.turnEnded();
    expect(started).toHaveLength(1);
  });

  test("the timer survives the turn ending without changes, and the person writing", () => {
    const { check, started } = scheduler();
    check.codeChanged();
    check.personWrote();
    jest.advanceTimersByTime(PAGE_CHECK_QUIET_MS);
    expect(started).toEqual([{ reason: "quiet", focus: null }]);
  });

  test("a turn that changed nothing starts nothing", () => {
    const { check, started } = scheduler();
    check.turnEnded();
    expect(started).toEqual([]);
  });

  test("verify starts one at once, changed or not", () => {
    const { check, started } = scheduler();
    expect(check.checkNow({ reason: "verify", focus: "the hero" })).toEqual({
      status: "started",
    });
    expect(started).toEqual([{ reason: "verify", focus: "the hero" }]);
  });

  test("asked for while one runs, it runs once more after it, with the latest focus", () => {
    const { check, started } = scheduler();
    check.checkNow({ reason: "verify", focus: "first" });
    expect(check.checkNow({ reason: "verify", focus: "second" })).toEqual({
      status: "queued",
    });
    check.codeChanged();
    check.turnEnded();
    expect(started).toHaveLength(1);
    check.finished();
    expect(started).toEqual([
      { reason: "verify", focus: "first" },
      { reason: "turn-ended", focus: "second" },
    ]);
    check.finished();
    expect(started).toHaveLength(2);
  });

  test(`at most ${PAGE_CHECKS_PER_MESSAGE} per message from the person, however they start`, () => {
    const { check, started } = scheduler();
    for (let i = 0; i < PAGE_CHECKS_PER_MESSAGE; i++) {
      check.codeChanged();
      check.turnEnded();
      check.finished();
    }
    expect(started).toHaveLength(PAGE_CHECKS_PER_MESSAGE);
    expect(check.left()).toBe(0);
    expect(check.checkNow({ reason: "verify", focus: null })).toEqual({
      status: "limited",
    });
    check.codeChanged();
    jest.advanceTimersByTime(PAGE_CHECK_QUIET_MS);
    expect(started).toHaveLength(PAGE_CHECKS_PER_MESSAGE);
    // Only the person writing gives it more.
    check.personWrote();
    expect(check.checkNow({ reason: "verify", focus: null })).toEqual({
      status: "started",
    });
  });

  test("left, no timer goes off later", () => {
    const { check, started } = scheduler();
    check.codeChanged();
    check.dispose();
    jest.advanceTimersByTime(PAGE_CHECK_QUIET_MS);
    expect(started).toEqual([]);
  });
});
