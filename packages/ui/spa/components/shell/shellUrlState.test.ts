import {
  applyShellUrlState,
  historyModeFor,
  parseShellUrlState,
  type ShellUrlState,
} from "./useShellUrlState";

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
      locale: null,
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
        locale: null,
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
      locale: "nb-NO",
    };
    expect(parseShellUrlState(applyShellUrlState("", state))).toEqual(state);
  });

  describe("the locale filter", () => {
    test("all locales is the default, and writes nothing", () => {
      // Most projects have no languages at all. They should not carry a param
      // that says they are not filtered.
      expect(parseShellUrlState("").locale).toBeNull();
      expect(
        applyShellUrlState("", {
          panel: null,
          canvasOpen: false,
          canvasRoute: null,
          canvasView: "normal",
          canvasTransform: null,
          locale: null,
        }),
      ).toBe("");
    });

    test("a chosen language round-trips", () => {
      const written = applyShellUrlState("", {
        panel: null,
        canvasOpen: false,
        canvasRoute: null,
        canvasView: "normal",
        canvasTransform: null,
        locale: "nb-NO",
      });
      expect(written).toBe("?locale=nb-NO");
      expect(parseShellUrlState(written).locale).toBe("nb-NO");
    });

    test("a language the project does not have is read, not rejected", () => {
      // Parsing runs before the settings module has loaded, so there is nothing
      // to check against here. The picker resolves it and falls back to all
      // locales — see `LocaleFilter`.
      expect(parseShellUrlState("?locale=sv-SE").locale).toBe("sv-SE");
    });
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
      locale: null,
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
      locale: null,
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
      locale: null,
    });
    expect(written).toContain("canvas-at=0.56%2C-121%2C40");
  });
});

/**
 * Which view changes are places you can come back to.
 *
 * Everything in the shell's URL used to be written with `replaceState`, on the
 * grounds that chrome is not history — which is right for a panel and wrong for
 * the canvas: closing it left no way back to the page you were looking at, and
 * the back button instead took you out of the module.
 */
describe("history for a view change", () => {
  const state = (over: Partial<ShellUrlState> = {}): ShellUrlState => ({
    panel: null,
    canvasOpen: false,
    canvasRoute: null,
    canvasView: "normal",
    canvasTransform: null,
    locale: null,
    ...over,
  });

  /**
   * The case that made this compare against the URL rather than against the last
   * state written: a link opens the canvas, the editor closes it, and that is
   * the FIRST write of the session. Classified against a tracked "previous" it
   * had nothing to compare to and went in as a replace — so the back button
   * left the studio instead of reopening the canvas.
   */
  test("closing a canvas a link opened is a place, even as the first write", () => {
    expect(historyModeFor(state({ canvasOpen: true }), state())).toBe("push");
  });

  /**
   * And the write that follows a back is not. The shell adopts the state the
   * entry names and reports it, which produces a write of what the URL already
   * says — an entry there would be a duplicate the user has to press through.
   */
  test("re-writing what the URL already says replaces", () => {
    const open = state({ canvasOpen: true });
    expect(
      historyModeFor(open, {
        ...open,
        canvasTransform: { scale: 1.2, x: 4, y: 8 },
      }),
    ).toBe("replace");
  });

  test("opening the canvas is a place", () => {
    expect(historyModeFor(state(), state({ canvasOpen: true }))).toBe("push");
  });

  test("a panel is not", () => {
    expect(historyModeFor(state(), state({ panel: "pages" }))).toBe("replace");
  });

  test("panning the canvas is not, however many times it moves", () => {
    const open = state({ canvasOpen: true });
    for (const at of [1, 2, 3]) {
      expect(
        historyModeFor(
          open,
          state({
            canvasOpen: true,
            canvasTransform: { scale: at, x: at, y: at },
          }),
        ),
      ).toBe("replace");
    }
  });

  test("switching the canvas view is not: the canvas is still open", () => {
    expect(
      historyModeFor(
        state({ canvasOpen: true }),
        state({ canvasOpen: true, canvasView: "fields" }),
      ),
    ).toBe("replace");
  });
});
