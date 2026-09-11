/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { ShellBreakpoint } from "./types";

/**
 * The way into history, at every size.
 *
 * The History button sits in the top bar's icon row, and the buttons around it
 * are NOT all rendered at every breakpoint: Review, Preview, Publish and Quick
 * actions are each behind `!isMobile`. A refactor that widened one of those
 * guards to cover this button would take history away from phones and tablets
 * without failing anything - the desktop screenshot would look untouched, and
 * the only symptom is a feature that silently does not exist on an iPad.
 *
 * So the breakpoints are pinned rather than the layout. The panel itself is
 * already responsive (`mobileVariant="bottom-sheet"`), and `HistorySplit`
 * turns the two panes into "Now" / the commit as tabs below desktop.
 */
/*
 * jsdom has no `matchMedia`, and the non-desktop top bar reaches it through
 * `usePrefersReducedMotion`. Stubbed rather than worked around: the reduced
 * motion answer is irrelevant here, and without it the mobile and tablet cases
 * fail for a reason that has nothing to do with the button.
 */
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

function topBar(breakpoint: ShellBreakpoint, historyEnabled: boolean) {
  return (
    <TopBar
      breakpoint={breakpoint}
      projectName="Test"
      openPanel={null}
      onTogglePanel={() => undefined}
      onOpenMenu={() => undefined}
      onOpenSearch={() => undefined}
      onPreview={() => undefined}
      isCanvasOpen={false}
      onPublish={() => undefined}
      pendingChanges={0}
      historyEnabled={historyEnabled}
    />
  );
}

const BREAKPOINTS: ShellBreakpoint[] = ["mobile", "tablet", "desktop"];

describe("the History button", () => {
  test.each(BREAKPOINTS)("is offered on %s", (breakpoint) => {
    render(topBar(breakpoint, true));
    expect(screen.getByRole("button", { name: "History" })).not.toBeNull();
  });

  /*
   * Hidden in fs mode, where `historySlot` is undefined: local dev has git
   * rather than a commit archive, and /history/commits answers
   * `not-supported-in-fs-mode`. A button that can only open an apology is
   * worse than no button - and that has to hold on a phone too.
   */
  test.each(BREAKPOINTS)(
    "is hidden on %s when there is no published history",
    (breakpoint) => {
      render(topBar(breakpoint, false));
      expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    },
  );
});
