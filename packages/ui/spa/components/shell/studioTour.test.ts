/** @jest-environment jsdom */
import {
  readTourCompleted,
  readTourEnabled,
  studioTourSteps,
  writeTourCompleted,
  writeTourEnabled,
} from "./studioTour";

/**
 * Which stops the tour has, for a given project.
 *
 * The conditional halves are the point: a tour that explains Pages to a
 * project with no router sends someone looking for an icon that is not in the
 * rail, which leaves them more confused than the tour found them.
 */
describe("studioTourSteps", () => {
  const ids = (...args: Parameters<typeof studioTourSteps>) =>
    studioTourSteps(...args).map((step) => step.id);

  test("a project with everything gets every stop, in shipping order", () => {
    expect(ids(["pages", "media", "data", "settings"])).toEqual([
      "welcome",
      "pages",
      "media",
      "data",
      "review",
      "preview",
      "publish",
      "finish",
    ]);
  });

  test("a project of pure content files is not told about Pages or Media", () => {
    expect(ids(["data"])).toEqual([
      "welcome",
      "data",
      "review",
      "preview",
      "publish",
      "finish",
    ]);
  });

  test("a marketing site is not told about Data", () => {
    expect(ids(["pages", "media"])).not.toContain("data");
  });

  // Review, Preview and Publish are not conditional on anything: every project
  // ships changes, and those three are how.
  test("shipping is explained even to a project with no destinations at all", () => {
    expect(ids([])).toEqual([
      "welcome",
      "review",
      "preview",
      "publish",
      "finish",
    ]);
  });

  test("every step points at a control, or deliberately at nothing", () => {
    for (const step of studioTourSteps(["pages", "media", "data"])) {
      expect(step.title).not.toBe("");
      expect(step.body).not.toBe("");
    }
  });

  /**
   * The publish control says "Save" on a local checkout — see `PublishButton`
   * — so a step that says "Publish sends it live" is pointing at a button with
   * a different word on it, promising something that does not happen there.
   */
  test("the publish step follows what the button actually says", () => {
    const http = studioTourSteps([], "http").find((s) => s.id === "publish");
    const fs = studioTourSteps([], "fs").find((s) => s.id === "publish");
    expect(http?.title).toMatch(/Publish/);
    expect(fs?.title).toMatch(/Save/);
    // And says where it actually goes, rather than promising a deploy.
    expect(fs?.body).toMatch(/on disk/);
  });

  // Both steps point at the same control, whatever it is called: the tour has
  // one marker to find, and the app decides which button carries it.
  test("both publish steps point at the same control", () => {
    const http = studioTourSteps([], "http").find((s) => s.id === "publish");
    const fs = studioTourSteps([], "fs").find((s) => s.id === "publish");
    expect(http?.target).toBe("publish");
    expect(fs?.target).toBe("publish");
  });

  test("a destination step opens the panel it is about", () => {
    const steps = studioTourSteps(["pages", "media", "data"]);
    expect(steps.find((s) => s.id === "pages")?.panel).toBe("pages");
    expect(steps.find((s) => s.id === "media")?.panel).toBe("media");
    expect(steps.find((s) => s.id === "data")?.panel).toBe("data");
  });

  /**
   * The first step closes whatever was open. Starting the tour from the Quick
   * actions panel otherwise left that panel over the top of the welcome card.
   */
  test("the welcome step asks for no panel, which closes any open one", () => {
    expect(studioTourSteps(["pages"])[0].panel).toBeUndefined();
  });
});

describe("the tour preferences", () => {
  beforeEach(() => localStorage.clear());

  test("a fresh browser has not been through it, and may be offered it", () => {
    expect(readTourCompleted()).toBe(false);
    expect(readTourEnabled()).toBe(true);
  });

  test("both are remembered", () => {
    writeTourCompleted(true);
    writeTourEnabled(false);
    expect(readTourCompleted()).toBe(true);
    expect(readTourEnabled()).toBe(false);
  });

  test("turning the offer back on works", () => {
    writeTourEnabled(false);
    writeTourEnabled(true);
    expect(readTourEnabled()).toBe(true);
  });

  /**
   * Storage that throws — a private window, a browser told to block site data
   * — must not take the Studio down, and must not read as a refusal either:
   * the fallback is the fresh-browser answer, which is the helpful one.
   */
  test("storage that throws leaves the helpful defaults, not an error", () => {
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
    expect(readTourEnabled()).toBe(true);
    expect(readTourCompleted()).toBe(false);
    expect(() => writeTourCompleted(true)).not.toThrow();
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
