/**
 * @jest-environment jsdom
 */
import {
  INTERACT_SETTLE_TIMEOUT_MS,
  isPageAction,
  PAGE_ACTION_KINDS,
  waitForPageSettle,
} from "./pageInteraction";
import {
  BRIDGE_CAPABILITIES,
  interactCapability,
  interactOutcomeOf,
  isValCanvasPageMessage,
  isValCanvasStudioMessage,
  VAL_CANVAS_MESSAGE,
} from "./valCanvasProtocol";

/**
 * When the page counts as settled: what every `interact_page` answer waits
 * for, so that it describes the page AFTER the action took effect -- the
 * lesson of `screenshot_page`, whose picture was sometimes of the page
 * before.
 */
describe("waiting for the page to settle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = "<main><p>Hello</p></main>";
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  /** Let fake time pass, a poll at a time, so observers get to run. */
  const pass = async (ms: number) => {
    for (let waited = 0; waited < ms; waited += 50) {
      await jest.advanceTimersByTimeAsync(50);
    }
  };

  it("settles once nothing has changed for the quiet period", async () => {
    let result: { settled: boolean; waitedMs: number } | null = null;
    void waitForPageSettle(window, {
      timeoutMs: 5000,
      quietMs: 300,
      inFlight: () => 0,
    }).then((settle) => {
      result = settle;
    });
    await pass(200);
    expect(result).toBeNull();
    await pass(200);
    expect(result).toMatchObject({ settled: true, busy: [] });
  });

  it("waits out a change to the DOM, then the quiet after it", async () => {
    let settled = false;
    void waitForPageSettle(window, {
      timeoutMs: 5000,
      quietMs: 300,
      inFlight: () => 0,
    }).then(() => {
      settled = true;
    });
    await pass(250);
    document.querySelector("p")?.append(" world");
    await pass(200);
    // 450ms in, but only 200 since the page changed.
    expect(settled).toBe(false);
    await pass(200);
    expect(settled).toBe(true);
  });

  it("waits for requests in flight", async () => {
    let inFlight = 1;
    let settled = false;
    void waitForPageSettle(window, {
      timeoutMs: 5000,
      quietMs: 100,
      inFlight: () => inFlight,
    }).then(() => {
      settled = true;
    });
    await pass(1000);
    expect(settled).toBe(false);
    inFlight = 0;
    await pass(200);
    expect(settled).toBe(true);
  });

  it("waits for the width it was resized to", async () => {
    let settled = false;
    void waitForPageSettle(window, {
      timeoutMs: 5000,
      quietMs: 100,
      inFlight: () => 0,
      width: 390,
    }).then(() => {
      settled = true;
    });
    await pass(500);
    expect(settled).toBe(false);
    Reflect.set(window, "innerWidth", 390);
    await pass(200);
    expect(settled).toBe(true);
    Reflect.set(window, "innerWidth", 1024);
  });

  it("gives up at the timeout, and says what kept it busy", async () => {
    let result: unknown = null;
    void waitForPageSettle(window, {
      timeoutMs: 1000,
      quietMs: 300,
      inFlight: () => 2,
    }).then((settle) => {
      result = settle;
    });
    const ticker = setInterval(() => {
      document.querySelector("p")?.append(".");
    }, 100);
    await pass(1200);
    clearInterval(ticker);
    expect(result).toMatchObject({
      settled: false,
      busy: ["requests", "changing"],
    });
  });

  it("has one bound, long enough for a page to load in development", () => {
    expect(INTERACT_SETTLE_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("the interact request and its answer", () => {
  it("lists a capability per action, so a new action is a new name", () => {
    for (const kind of PAGE_ACTION_KINDS) {
      expect(BRIDGE_CAPABILITIES).toContain(interactCapability(kind));
    }
    expect(BRIDGE_CAPABILITIES).not.toContain("interact");
  });

  it("takes only actions it knows", () => {
    expect(isPageAction({ kind: "click", selector: "main > a" })).toBe(true);
    expect(isPageAction({ kind: "press", key: "Enter" })).toBe(true);
    expect(isPageAction({ kind: "press", key: "F5" })).toBe(false);
    expect(isPageAction({ kind: "type", text: "x".repeat(10_000) })).toBe(
      false,
    );
    expect(isPageAction({ kind: "scroll" })).toBe(false);
    expect(
      isValCanvasStudioMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "interact",
        requestId: "r1",
        action: { kind: "open", path: "https://elsewhere.example" },
      }),
    ).toBe(false);
    expect(
      isValCanvasStudioMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "interact",
        requestId: "r1",
        action: { kind: "settle", width: 390 },
        timeoutMs: 5000,
      }),
    ).toBe(true);
  });

  it("reads an answer it does not know as no answer, not as a broken message", () => {
    const answer = {
      val: VAL_CANVAS_MESSAGE,
      type: "interacted",
      requestId: "r1",
      outcome: { status: "teleported" },
    };
    expect(isValCanvasPageMessage(answer)).toBe(true);
    expect(interactOutcomeOf(answer.outcome)).toBeNull();
    expect(
      interactOutcomeOf({ status: "refused", error: "No such element" }),
    ).toEqual({ status: "refused", error: "No such element" });
    const approval = {
      hold: "h1",
      page: "/",
      label: "Buy",
      did: "clicked <button>",
      before: { url: "/" },
      requests: [
        { via: "fetch", method: "POST", url: "http://localhost/checkout" },
        // Not a request this release knows: left out, not trusted.
        { via: "carrier-pigeon", method: "POST", url: "/x" },
      ],
    };
    expect(interactOutcomeOf({ status: "needs-approval", approval })).toEqual({
      status: "needs-approval",
      approval: { ...approval, requests: [approval.requests[0]] },
    });
    // The shape of the request before: not an approval any more.
    expect(
      interactOutcomeOf({
        status: "needs-approval",
        approval: { via: "click", page: "/", label: "Buy", method: "POST" },
      }),
    ).toBeNull();
  });
});
