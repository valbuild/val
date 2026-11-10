/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { PhonePaneBar } from "./workspace/PhonePaneBar";
import { TopBar } from "./TopBar";
import { UtilityPanel } from "./UtilityPanel";
import { ShellBreakpoint } from "./types";

/**
 * The ways into the assistant, in a project that has no assistant.
 *
 * A project can turn the assistant off (`s.settings()`, `assistant.enabled`)
 * and one
 * with no reachable model has none either way — and both controls used to be
 * rendered unconditionally: a Sparkles button in the top bar and an "Ask the
 * assistant" row in the quick actions, each of which opened a panel that could
 * only say there was nothing there. The panel is hidden by `Shell` (see
 * `aiEnabled`), which is not unit-testable here — it pulls in the canvas and
 * with it the whole shared bundle — so what is pinned is the two controls that
 * lead to it.
 */
/*
 * jsdom has no `matchMedia`, and the non-desktop top bar reaches it through
 * `usePrefersReducedMotion`. Stubbed for the same reason
 * `historyAffordance.test.tsx` stubs it: the reduced motion answer is
 * irrelevant here, and without it the mobile case fails for a reason that has
 * nothing to do with the assistant.
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

function topBar(aiEnabled: boolean, breakpoint: ShellBreakpoint = "desktop") {
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
      aiEnabled={aiEnabled}
    />
  );
}

/** The phone's pane bar, with the assistant as one of its panes. */
function paneBar(onShowAssistant: () => void) {
  return (
    <PhonePaneBar
      shown="content"
      panes={[
        { pane: "content", onShow: () => undefined },
        { pane: "preview", onShow: () => undefined },
        { pane: "chat", onShow: onShowAssistant },
      ]}
    />
  );
}

function utilityPanel(onOpenAI?: () => void) {
  return (
    <UtilityPanel
      breakpoint="desktop"
      onNewPage={() => undefined}
      onUploadMedia={() => undefined}
      onOpenAI={onOpenAI}
      onSelectActivity={() => undefined}
      onClose={() => undefined}
    />
  );
}

describe("the ways into the assistant", () => {
  test("the top bar offers one when the project has an assistant", () => {
    render(topBar(true));
    expect(screen.queryByLabelText("AI assistant")).not.toBeNull();
  });

  test("and none when it does not", () => {
    render(topBar(false));
    expect(screen.queryByLabelText("AI assistant")).toBeNull();
    // The rest of the bar is untouched — this hides one button, not the row.
    expect(screen.queryByLabelText("Quick actions")).not.toBeNull();
  });

  /**
   * On a phone the assistant is one of the panes in the BOTTOM bar, not a
   * button in the top one: the top right corner of a phone is the furthest
   * point from a thumb, and two ways to one pane are two places to look.
   */
  test("on a phone it is a pane in the bottom bar, and tapping it shows it", () => {
    const onShow = jest.fn();
    render(paneBar(onShow));
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  test("and not in the top bar", () => {
    render(topBar(true, "mobile"));
    expect(screen.queryByLabelText("AI assistant")).toBeNull();
  });

  test("the bottom bar has no Assistant pane when the project has no assistant", () => {
    render(
      <PhonePaneBar
        shown="content"
        panes={[
          { pane: "content", onShow: () => undefined },
          { pane: "preview", onShow: () => undefined },
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: "Assistant" })).toBeNull();
    // As above: this leaves out one pane, not the bar.
    expect(screen.queryByRole("button", { name: "Content" })).not.toBeNull();
  });

  test("the quick actions offer one when there is somewhere to go", () => {
    render(utilityPanel(() => undefined));
    expect(screen.queryByText("Ask the assistant")).not.toBeNull();
  });

  test("and none when there is not", () => {
    render(utilityPanel(undefined));
    expect(screen.queryByText("Ask the assistant")).toBeNull();
  });
});
