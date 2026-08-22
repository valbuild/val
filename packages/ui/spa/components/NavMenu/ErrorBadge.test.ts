import { aggregateTooltipText } from "./ErrorBadge";

describe("aggregateTooltipText", () => {
  test("says 'below' for a row badge, which sits above its rows", () => {
    expect(aggregateTooltipText(1, "below")).toBe("1 error below");
    expect(aggregateTooltipText(4, "below")).toBe("4 errors below");
  });

  test("a section header badge says the errors are inside the section", () => {
    // The section header sits above a whole collapsible section, so its errors
    // are IN it, not below it. Hard-coding "below" made the section tooltip
    // point at nothing - the rows it names are hidden while collapsed.
    expect(aggregateTooltipText(1, "in this section")).toBe(
      "1 error in this section",
    );
    expect(aggregateTooltipText(9, "in this section")).toBe(
      "9 errors in this section",
    );
  });
});
