/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { UtilityPanel, reviewChangesLabel } from "./UtilityPanel";

/**
 * Review in the quick actions, which on a phone is the only place it exists:
 * the top bar hides it below the mobile breakpoint, and the bottom bar has
 * room for Preview and Publish and nothing else.
 *
 * It used to appear only when something was pending, so a phone could not
 * answer "is anything of mine still unpublished?" — an empty row of quick
 * actions looks the same as a row that has not loaded.
 */
function panel(props: Partial<Parameters<typeof UtilityPanel>[0]> = {}) {
  return (
    <UtilityPanel
      breakpoint="mobile"
      activity={[]}
      onNewPage={() => undefined}
      onUploadMedia={() => undefined}
      onClose={() => undefined}
      onSelectActivity={() => undefined}
      onCompare={() => undefined}
      pendingChanges={0}
      {...props}
    />
  );
}

describe("Review in the quick actions", () => {
  test("is offered on a phone with nothing pending, and says so", () => {
    render(panel());
    expect(screen.queryByText(reviewChangesLabel(0, undefined))).not.toBeNull();
  });

  test("counts the changes when there are some", () => {
    render(panel({ pendingChanges: 3 }));
    expect(screen.queryByText("Review 3 changes")).not.toBeNull();
  });

  test("is not offered above the mobile breakpoint - the top bar has it", () => {
    render(panel({ breakpoint: "desktop", pendingChanges: 3 }));
    expect(screen.queryByText(/^Review /)).toBeNull();
  });

  test("is not offered when there is no compare view to open", () => {
    render(panel({ onCompare: undefined, pendingChanges: 3 }));
    expect(screen.queryByText(/^Review /)).toBeNull();
  });
});

describe("reviewChangesLabel", () => {
  test("names the empty case rather than counting to zero", () => {
    expect(reviewChangesLabel(0, undefined)).toBe(
      "Review changes · none pending",
    );
  });

  test("singular for one", () => {
    expect(reviewChangesLabel(1, undefined)).toBe("Review 1 change");
  });

  // `reviewCount` is what Review would actually show: zero when the pending
  // patches cancel each other out. It wins over the raw patch count.
  test("prefers the review count over the patch count", () => {
    expect(reviewChangesLabel(4, 0)).toBe("Review changes · none pending");
    expect(reviewChangesLabel(4, 2)).toBe("Review 2 changes");
  });
});
