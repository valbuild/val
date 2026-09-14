/** @jest-environment jsdom */
import {
  readTourCompleted,
  studioTourSteps,
  TourMode,
  writeTourCompleted,
} from "./tourSteps";
import { TOUR_COPY } from "./tourCopy";
import { isTourOffered, readStudioSettings } from "../../hooks/studioSettings";

/**
 * Which stops the tour has, for a given project.
 *
 * The conditional halves are the point: a tour that explains Pages to a
 * project with no router sends someone looking for an icon that is not in the
 * rail, which leaves them more confused than the tour found them.
 */
describe("studioTourSteps", () => {
  const ids = (project: Parameters<typeof studioTourSteps>[0]) =>
    studioTourSteps(project).map((step) => step.id);

  test("a project with everything gets every stop, in the order it is done", () => {
    expect(
      ids({
        destinations: ["pages", "media", "data", "settings"],
        aiEnabled: true,
      }),
    ).toEqual([
      "welcome",
      "pages",
      "media",
      "data",
      "ai",
      "review",
      "preview",
      "publish",
      "finish",
    ]);
  });

  test("a project of pure content files is not told about Pages or Media", () => {
    expect(ids({ destinations: ["data"] })).toEqual([
      "welcome",
      "data",
      "review",
      "preview",
      "publish",
      "finish",
    ]);
  });

  test("a marketing site is not told about Data", () => {
    expect(ids({ destinations: ["pages", "media"] })).not.toContain("data");
  });

  /**
   * The assistant is explained only where there is one. Every way into it is
   * hidden for a project that has not configured one — see `ShellProps.aiEnabled`
   * — so a step about it would point at nothing and describe nothing.
   */
  test("a project with no assistant is not told about one", () => {
    expect(ids({ destinations: ["pages"] })).not.toContain("ai");
    expect(ids({ destinations: ["pages"], aiEnabled: true })).toContain("ai");
  });

  /**
   * It comes before Review: the assistant is part of MAKING a change, and
   * everything from Review onwards is about sending one.
   */
  test("the assistant comes before the shipping steps", () => {
    const order = ids({ destinations: ["pages"], aiEnabled: true });
    expect(order.indexOf("ai")).toBeLessThan(order.indexOf("review"));
    expect(order.indexOf("ai")).toBeGreaterThan(order.indexOf("pages"));
  });

  // Review, Preview and Publish are not conditional on anything: every project
  // ships changes, and those three are how.
  test("shipping is explained even to a project with no destinations at all", () => {
    expect(ids({ destinations: [] })).toEqual([
      "welcome",
      "review",
      "preview",
      "publish",
      "finish",
    ]);
  });

  test("every step says something", () => {
    for (const step of studioTourSteps({
      destinations: ["pages", "media", "data"],
      aiEnabled: true,
    })) {
      expect(step.title).not.toBe("");
      expect(step.body).not.toBe("");
    }
  });

  /**
   * The publish control says "Save" on a local checkout — see `PublishButton` —
   * so the step has to be the one written for that, or it points at a button
   * with a different word on it and promises something that does not happen.
   *
   * Asserted as "this step carries THAT entry", never by matching the prose.
   * `tourCopy.ts` exists to be rewritten, and a test that pins its wording
   * fails on whoever does the rewriting for a reason that has nothing to do
   * with what they changed.
   */
  test("the publish step follows what the button actually says", () => {
    const stepFor = (mode: TourMode) =>
      studioTourSteps({ destinations: [], mode }).find(
        (s) => s.id === "publish",
      );
    expect(stepFor("http")).toMatchObject(TOUR_COPY.publish);
    expect(stepFor("fs")).toMatchObject(TOUR_COPY.save);
  });

  // Both steps point at the same control, whatever it is called: the tour has
  // one marker to find, and the app decides which button carries it.
  test("both publish steps point at the same control", () => {
    const http = studioTourSteps({ destinations: [], mode: "http" }).find(
      (s) => s.id === "publish",
    );
    const fs = studioTourSteps({ destinations: [], mode: "fs" }).find(
      (s) => s.id === "publish",
    );
    expect(http?.target).toBe("publish");
    expect(fs?.target).toBe("publish");
  });

  test("a destination step opens the panel it is about", () => {
    const steps = studioTourSteps({
      destinations: ["pages", "media", "data"],
      aiEnabled: true,
    });
    expect(steps.find((s) => s.id === "pages")?.panel).toBe("pages");
    expect(steps.find((s) => s.id === "media")?.panel).toBe("media");
    expect(steps.find((s) => s.id === "data")?.panel).toBe("data");
    expect(steps.find((s) => s.id === "ai")?.panel).toBe("ai");
  });

  /**
   * The first step closes whatever was open. Starting the tour from the Quick
   * actions panel otherwise left that panel over the top of the welcome card.
   */
  test("the welcome step asks for no panel, which closes any open one", () => {
    expect(
      studioTourSteps({ destinations: ["pages"] })[0].panel,
    ).toBeUndefined();
  });
});

/**
 * The one thing about the tour that is per browser: whether this person has
 * already been through it. Whether it is offered at all is the project's, and
 * is tested below.
 */
describe("the completed flag", () => {
  beforeEach(() => localStorage.clear());

  test("a fresh browser has not been through it", () => {
    expect(readTourCompleted()).toBe(false);
  });

  test("is remembered", () => {
    writeTourCompleted(true);
    expect(readTourCompleted()).toBe(true);
  });

  /**
   * Storage that throws — a private window, a browser told to block site data
   * — must not take the Studio down, and must not read as "already seen"
   * either: the fallback is the fresh-browser answer.
   */
  test("storage that throws leaves the default, not an error", () => {
    const getItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(readTourCompleted()).toBe(false);
    expect(() => writeTourCompleted(true)).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});

/**
 * Whether the tour is offered is the PROJECT's answer, in `s.settings()` under
 * `studio.tour` — so a team that finds it noisy turns it off once, for
 * everyone, instead of each person dismissing it on each machine.
 *
 * Read out of `Json`, so every shape a hand-written settings file can be in has
 * to answer something sensible rather than throw.
 */
describe("the project's tour setting", () => {
  const offered = (source: unknown) =>
    // `readStudioSettings` takes `Json`; these are the shapes a settings module
    // can actually be in, including the broken ones.
    isTourOffered(
      readStudioSettings(source as Parameters<typeof readStudioSettings>[0]),
    );

  test("an untouched project offers it", () => {
    expect(offered({})).toBe(true);
    expect(offered({ studio: {} })).toBe(true);
    expect(offered({ studio: { tour: null } })).toBe(true);
  });

  test("a project that has turned it off does not", () => {
    expect(offered({ studio: { tour: false } })).toBe(false);
  });

  test("a project that has turned it on does", () => {
    expect(offered({ studio: { tour: true } })).toBe(true);
  });

  /**
   * Unset is not "no". A settings module that is missing, still loading, or
   * currently nonsense must not silently hide the tour from every project that
   * never touched this.
   */
  test("anything unreadable still offers it", () => {
    expect(offered(undefined)).toBe(true);
    expect(offered(null)).toBe(true);
    expect(offered([])).toBe(true);
    expect(offered("nonsense")).toBe(true);
    expect(offered({ studio: "nonsense" })).toBe(true);
    expect(offered({ studio: { tour: "false" } })).toBe(true);
  });
});
