import {
  ANSWERED_BEFORE_CAPABILITIES,
  BRIDGE_CAPABILITIES,
  bridgeAnswers,
  bridgeInfoOf,
  capabilitiesOf,
  isValCanvasPageMessage,
  isValCanvasStudioMessage,
  VAL_CANVAS_MESSAGE,
} from "./valCanvasProtocol";

/**
 * The handshake: a bridge says in `ready` which requests it answers, so the
 * Studio never waits on one it would not.
 */
describe("canvas capabilities", () => {
  it("a bridge that lists them answers what it lists, and nothing else", () => {
    expect(bridgeAnswers(["readPage", "readPageLog"], "readPageLog")).toBe(
      true,
    );
    expect(bridgeAnswers(["readPage"], "screenshotPage")).toBe(false);
  });

  it("a bridge from before the list answers what bridges always did", () => {
    for (const request of ANSWERED_BEFORE_CAPABILITIES) {
      expect(bridgeAnswers(undefined, request)).toBe(true);
    }
    expect(bridgeAnswers(undefined, "readPageLog")).toBe(false);
  });

  it("this release's bridges answer everything older ones did", () => {
    for (const request of ANSWERED_BEFORE_CAPABILITIES) {
      expect(BRIDGE_CAPABILITIES).toContain(request);
    }
  });

  it("ready carries the list and the bridge, and ignores names it does not know", () => {
    const ready = {
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode: true,
      url: "http://localhost/",
      capabilities: ["readPage", "interactPage"],
      bridge: { package: "@valbuild/tanstack", version: "0.153.5" },
    };
    expect(isValCanvasPageMessage(ready)).toBe(true);
    // A shape this Studio does not expect is read as absent, never as a
    // reason to drop the whole `ready` (a preview stuck on "no answer").
    expect(isValCanvasPageMessage({ ...ready, capabilities: "readPage" })).toBe(
      true,
    );
    expect(
      isValCanvasPageMessage({
        ...ready,
        bridge: { package: 1, version: null },
      }),
    ).toBe(true);
    // A bridge of the release before: neither.
    const { capabilities: _, bridge: __, ...older } = ready;
    expect(isValCanvasPageMessage(older)).toBe(true);
  });

  it("readPageLog is checked like every request", () => {
    const asked = {
      val: VAL_CANVAS_MESSAGE,
      type: "readPageLog",
      requestId: "r1",
      sinceNavigation: false,
      levels: ["error"],
    };
    expect(isValCanvasStudioMessage(asked)).toBe(true);
    expect(isValCanvasStudioMessage({ ...asked, levels: ["log"] })).toBe(false);
    expect(isValCanvasStudioMessage({ ...asked, requestId: 1 })).toBe(false);
    expect(
      isValCanvasPageMessage({
        val: VAL_CANVAS_MESSAGE,
        type: "pageLogRead",
        requestId: "r1",
        log: null,
        error: "no",
      }),
    ).toBe(true);
  });

  it("reads capabilities leniently: the strings in a list, or none", () => {
    expect(capabilitiesOf(["readPage", 3, null, "readPageLog"])).toEqual([
      "readPage",
      "readPageLog",
    ]);
    expect(capabilitiesOf("readPage")).toBeUndefined();
    expect(capabilitiesOf(undefined)).toBeUndefined();
  });

  it("reads the bridge leniently: a malformed one is absent", () => {
    expect(
      bridgeInfoOf({ package: "@valbuild/next", version: "0.153.5" }),
    ).toEqual({ package: "@valbuild/next", version: "0.153.5" });
    expect(bridgeInfoOf({ package: "@valbuild/next", version: 7 })).toEqual({
      package: "@valbuild/next",
      version: null,
    });
    expect(bridgeInfoOf({ package: 1 })).toBeUndefined();
    expect(bridgeInfoOf("@valbuild/next")).toBeUndefined();
  });
});
