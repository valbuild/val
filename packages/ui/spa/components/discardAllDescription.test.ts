import { discardAllDescription } from "./discardAllDescription";

/**
 * The confirm before Discard all.
 *
 * Tested as a string rather than through the popover because what goes wrong here
 * is grammar: the first version of it read "All 1 unpublished change ... go away"
 * and "made by, Bob and Alice", both of which typecheck perfectly.
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

  test("a single author is not named", () => {
    // Naming one author is either telling you your own name or naming the only
    // person it could be. Neither is worth a clause.
    expect(discardAllDescription(3, ["Bob Bakke"])).toBe(
      "All 3 unpublished changes in this project go away. This cannot be undone.",
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
});
