import { handoffCardIsNews } from "./PublishHandoff";

/*
 * Once the builder tab has handed its job to content, a Studio's own toast
 * and deploy list follow it: the card there said "Live" a second time. The
 * overlay has neither and shows it throughout.
 */
describe("is the handoff card the only thing saying it", () => {
  test("while the tab has the job: yes", () => {
    expect(handoffCardIsNews({ kind: "opening" })).toBe(true);
    expect(handoffCardIsNews({ kind: "blocked" })).toBe(true);
    expect(
      handoffCardIsNews({ kind: "running", step: "Building", elapsedMs: 0 }),
    ).toBe(true);
    // The tab's own failure, before content had anything.
    expect(handoffCardIsNews({ kind: "failed", message: "no" })).toBe(true);
  });

  test("once content has it, and what this page learned itself: no", () => {
    expect(handoffCardIsNews({ kind: "checking" })).toBe(false);
    expect(handoffCardIsNews({ kind: "live", ms: 1, followed: true })).toBe(
      false,
    );
    expect(
      handoffCardIsNews({ kind: "failed", message: "no", followed: true }),
    ).toBe(false);
  });
});
