import { applyShellUrlState, parseShellUrlState } from "./useShellUrlState";

/**
 * The view state, in and out of a URL.
 *
 * This is what makes a link a link: the route says what is being edited, and
 * these say what you are looking at while you edit it. Both halves are tested
 * because both halves have a way of being quietly wrong — a parse that throws
 * on a hand-edited URL, or a write that drops what it does not recognise.
 */
describe("the shell's URL state", () => {
  test("an empty query is the resting state", () => {
    expect(parseShellUrlState("")).toEqual({
      panel: null,
      canvasOpen: false,
      canvasRoute: null,
      canvasView: "normal",
      canvasTransform: null,
    });
  });

  test("the resting state writes no query at all", () => {
    // A link to nothing in particular should not look like a link to
    // something: `?canvas=0&canvas-view=normal` says the same thing as an
    // empty query and reads as though it does not.
    expect(
      applyShellUrlState("", {
        panel: null,
        canvasOpen: false,
        canvasRoute: null,
        canvasView: "normal",
        canvasTransform: null,
      }),
    ).toBe("");
  });

  test("round-trips a canvas someone was looking at", () => {
    const state = {
      panel: "pages" as const,
      canvasOpen: true,
      canvasRoute: "/blogs/blog1",
      canvasView: "fields" as const,
      canvasTransform: { scale: 0.56, x: -120, y: 40 },
    };
    expect(parseShellUrlState(applyShellUrlState("", state))).toEqual(state);
  });

  test("keeps query params it knows nothing about", () => {
    // The AI session id lives in the same query, and so will the next thing.
    // Writing the view state must not be how they get dropped.
    const written = applyShellUrlState("?session=abc123", {
      panel: null,
      canvasOpen: true,
      canvasRoute: null,
      canvasView: "normal",
      canvasTransform: null,
    });
    expect(written).toContain("session=abc123");
    expect(written).toContain("canvas=1");
  });

  test("clears what is no longer true", () => {
    // Closing the canvas has to remove the param, not leave a stale one that a
    // reload would obey.
    const written = applyShellUrlState("?canvas=1&canvas-view=fields", {
      panel: null,
      canvasOpen: false,
      canvasRoute: null,
      canvasView: "normal",
      canvasTransform: null,
    });
    expect(written).toBe("");
  });

  describe("a URL is something a person can edit", () => {
    test("an unknown panel is no panel, not a crash", () => {
      expect(parseShellUrlState("?panel=nonsense").panel).toBeNull();
    });

    test("a malformed position is ignored, and the canvas fits instead", () => {
      expect(
        parseShellUrlState("?canvas-at=nonsense").canvasTransform,
      ).toBeNull();
      expect(parseShellUrlState("?canvas-at=1,2").canvasTransform).toBeNull();
      expect(
        parseShellUrlState("?canvas-at=1,2,3,4").canvasTransform,
      ).toBeNull();
    });

    test("a zero or negative scale is not a view", () => {
      // The canvas divides by the scale, so this is a crash rather than an odd
      // rendering.
      expect(parseShellUrlState("?canvas-at=0,0,0").canvasTransform).toBeNull();
      expect(
        parseShellUrlState("?canvas-at=-1,0,0").canvasTransform,
      ).toBeNull();
    });
  });

  test("rounds the position, because nobody reads six decimals", () => {
    const written = applyShellUrlState("", {
      panel: null,
      canvasOpen: true,
      canvasRoute: null,
      canvasView: "normal",
      canvasTransform: { scale: 0.5612345, x: -120.7, y: 40.2 },
    });
    expect(written).toContain("canvas-at=0.56%2C-121%2C40");
  });
});
