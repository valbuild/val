/**
 * @jest-environment jsdom
 */
import { holdRequests, releaseHold, startRequestGate } from "./pageRequestGate";

/**
 * The request gate's wrappers, under what real pages do to them: gates that
 * overlap, and a release that lands while the next action's gate is up.
 * Nothing may be left stuck in the page's `fetch` afterwards.
 */
describe("the request gate", () => {
  let sent: string[];
  beforeEach(() => {
    sent = [];
    Reflect.set(
      window,
      "fetch",
      jest.fn((input: unknown, init?: { method?: string }) => {
        sent.push(`${init?.method ?? "GET"} ${String(input)}`);
        return Promise.resolve({ status: 200 });
      }),
    );
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "fetch");
  });

  const post = (path: string) =>
    window.fetch(path, { method: "POST" }).then(
      () => "sent",
      () => "refused",
    );

  it("leaves fetch working after overlapping gates stop, in either order", async () => {
    for (const order of [
      ["first", "second"],
      ["second", "first"],
    ]) {
      const gates = {
        first: startRequestGate(window, { mode: "hold" }),
        second: startRequestGate(window, { mode: "hold" }),
      };
      for (const name of order) {
        gates[name === "first" ? "first" : "second"].stop();
      }
      sent = [];
      await expect(post("/api/after")).resolves.toBe("sent");
      expect(sent).toEqual(["POST /api/after"]);
    }
  });

  it("sends a release that lands while the next action's gate is up", async () => {
    const first = startRequestGate(window, { mode: "hold" });
    const held = post("/api/first");
    const hold = holdRequests(window, first.stop());
    // The next action starts before the person answers.
    const next = startRequestGate(window, { mode: "hold" });
    releaseHold(window, hold, true);
    await expect(held).resolves.toBe("sent");
    expect(sent).toEqual(["POST /api/first"]);
    // The next gate still holds its own.
    const later = post("/api/second");
    const nextHeld = next.stop();
    expect(nextHeld.requests).toHaveLength(1);
    releaseHold(window, holdRequests(window, nextHeld), false);
    await expect(later).resolves.toBe("refused");
  });

  it("only refuses what leaves the site when the person approved the action", async () => {
    const gate = startRequestGate(window, { mode: "off-site" });
    const same = post("/api/save");
    const away = post("https://elsewhere.example/collect");
    const stopped = gate.stop();
    await expect(same).resolves.toBe("sent");
    await expect(away).resolves.toBe("refused");
    expect(stopped.requests).toEqual([]);
    expect(gate.blocked()).toEqual([
      {
        via: "fetch",
        method: "POST",
        url: "https://elsewhere.example/collect",
      },
    ]);
  });

  it("counts an XHR it let through as in flight until it ends", () => {
    // The page's XHR, sending nowhere: jsdom would make a real request.
    const send = jest
      .spyOn(XMLHttpRequest.prototype, "send")
      .mockImplementation(() => {});
    const gate = startRequestGate(window, { mode: "hold" });
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", "/api/products");
      xhr.send();
      expect(send).toHaveBeenCalledTimes(1);
      expect(gate.inFlight()).toBe(1);
      xhr.dispatchEvent(new ProgressEvent("loadend"));
      expect(gate.inFlight()).toBe(0);
    } finally {
      gate.stop();
      send.mockRestore();
    }
  });
});
