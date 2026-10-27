import { describeStuckSave } from "./describeStuckSave";

/**
 * The words for a save that keeps failing.
 *
 * Each reason has a different fix and a different person who can apply it, so
 * they must not read the same. And the titles must be stable, because
 * `StatusStore` de-duplicates by message: a title carrying the attempt count
 * would stack a fresh error on every backoff instead of updating one.
 */
describe("describeStuckSave", () => {
  test("an unreadable answer points at the version mismatch", () => {
    const report = describeStuckSave(
      "unparseable-response",
      "Response could not be validated.",
      3,
      1,
    );
    expect(report.title).toContain("was not understood");
    expect(report.detail).toContain("@valbuild/next");
    // The server's own words, not a paraphrase.
    expect(report.detail).toContain("Response could not be validated.");
  });

  test("a conflict points at the other writer", () => {
    const report = describeStuckSave("conflict", "head moved", 4, 2);
    expect(report.title).toContain("changing them first");
    expect(report.detail).toContain("Another tab");
  });

  test("a network error says nothing is known", () => {
    const report = describeStuckSave("network-error", "Failed to fetch", 2, 1);
    expect(report.title).toContain("could not be reached");
    expect(report.detail).toContain("may or may not have arrived");
  });

  test("the three titles are all different", () => {
    const titles = new Set(
      (["conflict", "network-error", "unparseable-response"] as const).map(
        (reason) => describeStuckSave(reason, "m", 2, 1).title,
      ),
    );
    expect(titles.size).toBe(3);
  });

  test("the title is stable across attempts, and the count is in the detail", () => {
    const third = describeStuckSave("network-error", "m", 3, 1);
    const ninth = describeStuckSave("network-error", "m", 9, 1);
    expect(third.title).toBe(ninth.title);
    expect(third.detail).toContain("3 times");
    expect(ninth.detail).toContain("9 times");
  });

  test("counts read as English", () => {
    expect(describeStuckSave("network-error", "m", 1, 1).detail).toContain(
      "Tried 1 time so far",
    );
    expect(describeStuckSave("network-error", "m", 2, 1).detail).toContain(
      "1 change are safe",
    );
    expect(describeStuckSave("network-error", "m", 2, 3).detail).toContain(
      "3 changes are safe",
    );
  });
});
