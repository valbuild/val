/** @jest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { UtilityPanel } from "./UtilityPanel";

/**
 * The ways into the assistant, in a project that has no assistant.
 *
 * A project can turn the assistant off (`s.settings()`, `ai.enabled`) and one
 * with no reachable model has none either way — and both controls used to be
 * rendered unconditionally: a Sparkles button in the top bar and an "Ask the
 * assistant" row in the quick actions, each of which opened a panel that could
 * only say there was nothing there. The panel is hidden by `Shell` (see
 * `aiEnabled`), which is not unit-testable here — it pulls in the canvas and
 * with it the whole shared bundle — so what is pinned is the two controls that
 * lead to it.
 */
function topBar(aiEnabled: boolean) {
  return (
    <TopBar
      breakpoint="desktop"
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

  test("the quick actions offer one when there is somewhere to go", () => {
    render(utilityPanel(() => undefined));
    expect(screen.queryByText("Ask the assistant")).not.toBeNull();
  });

  test("and none when there is not", () => {
    render(utilityPanel(undefined));
    expect(screen.queryByText("Ask the assistant")).toBeNull();
  });
});
