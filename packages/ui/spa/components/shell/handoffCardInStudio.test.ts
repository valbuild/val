import { handoffCardInStudio } from "./PublishHandoff";

/*
 * In the Studio the status bar's indicator follows the build and the edges,
 * so the card is only for what needs a hand: a blocked tab, or one that
 * failed before content had the job.
 */
describe("the handoff card in the Studio", () => {
  test("shows for a blocked tab and the tab's own failure", () => {
    expect(handoffCardInStudio({ kind: "blocked" })).toBe(true);
    expect(handoffCardInStudio({ kind: "failed", message: "no" })).toBe(true);
  });

  test("never for progress, or for Live however it was learned", () => {
    expect(handoffCardInStudio({ kind: "opening" })).toBe(false);
    expect(
      handoffCardInStudio({ kind: "running", step: "Building", elapsedMs: 0 }),
    ).toBe(false);
    expect(handoffCardInStudio({ kind: "checking" })).toBe(false);
    expect(handoffCardInStudio({ kind: "live", ms: 1 })).toBe(false);
    expect(handoffCardInStudio({ kind: "live", ms: 1, followed: true })).toBe(
      false,
    );
    expect(
      handoffCardInStudio({ kind: "failed", message: "no", followed: true }),
    ).toBe(false);
  });
});
