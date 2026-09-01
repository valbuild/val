import { discardAllDescription } from "./discardAllDescription";

/**
 * The confirm before Discard all.
 *
 * Tested as a string rather than through the popover because what goes wrong here
 * is grammar: the first version of it read "All 1 unpublished change ... go away"
 * and "made by, Bob and Alice", both of which typecheck perfectly.
 *
 * The names passed in are the OTHER authors — the caller has already dropped the
 * current user — so any name at all is news.
 */
describe("discardAllDescription", () => {
  test("one change agrees with its verb", () => {
    expect(discardAllDescription(1, [])).toBe(
      "1 unpublished change in this project goes away. This cannot be undone.",
    );
  });

  test("several changes say how many", () => {
    expect(discardAllDescription(12, [])).toBe(
      "All 12 unpublished changes in this project go away. This cannot be undone.",
    );
  });

  test("work that is only yours names nobody", () => {
    // The caller filtered itself out, so an empty list means every pending
    // change is the current user's own. Nothing to warn about.
    expect(discardAllDescription(3, [])).toBe(
      "All 3 unpublished changes in this project go away. This cannot be undone.",
    );
  });

  test("one other author is named", () => {
    // The case this view existed to cover and did not: one colleague's work,
    // about to be thrown away without their name appearing anywhere.
    expect(discardAllDescription(3, ["Bob Bakke"])).toBe(
      "All 3 unpublished changes in this project go away — including changes made by Bob Bakke. This cannot be undone.",
    );
  });

  test("two authors are both named", () => {
    expect(discardAllDescription(3, ["Bob Bakke", "Alice Andersen"])).toBe(
      "All 3 unpublished changes in this project go away — including changes made by Bob Bakke and Alice Andersen. This cannot be undone.",
    );
  });

  test("more than two authors are counted, not listed", () => {
    expect(
      discardAllDescription(9, [
        "Bob Bakke",
        "Alice Andersen",
        "Carol Chen",
        "Dan Hansen",
      ]),
    ).toBe(
      "All 9 unpublished changes in this project go away — including changes made by Bob Bakke, Alice Andersen and 2 others. This cannot be undone.",
    );
  });

  test("exactly three authors say 'other', singular", () => {
    expect(
      discardAllDescription(4, ["Bob Bakke", "Alice Andersen", "Carol Chen"]),
    ).toBe(
      "All 4 unpublished changes in this project go away — including changes made by Bob Bakke, Alice Andersen and 1 other. This cannot be undone.",
    );
  });

  test("one change with another author agrees with its verb", () => {
    expect(discardAllDescription(1, ["Bob Bakke"])).toBe(
      "1 unpublished change in this project goes away — including changes made by Bob Bakke. This cannot be undone.",
    );
  });
});
