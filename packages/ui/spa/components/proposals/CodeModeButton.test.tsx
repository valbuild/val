/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { render, screen } from "@testing-library/react";
import { CodeModeButton, type TopBarCodeMode } from "./CodeModeButton";
import type { ProposalSummary, StudioLocation } from "./types";

const proposal: ProposalSummary = {
  name: "a1b2c3d4e5f6a7b8c9d0",
  displayName: "Spring campaign",
  description: null,
  status: "open",
  owner: { name: "Kari Nordmann" },
  ownedByViewer: false,
  changes: 3,
  updatedAt: new Date(0).toISOString(),
};

const site: StudioLocation = { kind: "site" };
const inProposal: StudioLocation = {
  kind: "proposal",
  proposal,
  unsaved: 0,
  save: { state: "idle" },
  overlay: null,
  renderCheck: null,
  publishBlockedBy: null,
  code: null,
};

const codeMode = (openMenuRequests: number): TopBarCodeMode => ({
  on: false,
  onToggle: () => {},
  onOpenProposalInCodeMode: () => {},
  onNewProposalInCodeMode: () => {},
  openMenuRequests,
});

describe("CodeModeButton's menu, asked for from elsewhere", () => {
  test("opens on a new request on the site", () => {
    const { rerender } = render(
      <CodeModeButton
        location={site}
        proposals={[proposal]}
        codeMode={codeMode(0)}
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    rerender(
      <CodeModeButton
        location={site}
        proposals={[proposal]}
        codeMode={codeMode(1)}
      />,
    );
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  test("does not open on mount for a request already made", () => {
    render(
      <CodeModeButton
        location={site}
        proposals={[proposal]}
        codeMode={codeMode(3)}
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  test("a request made in a proposal does not open it on the site later", () => {
    const { rerender } = render(
      <CodeModeButton
        location={inProposal}
        proposals={[proposal]}
        codeMode={codeMode(0)}
      />,
    );
    rerender(
      <CodeModeButton
        location={inProposal}
        proposals={[proposal]}
        codeMode={codeMode(1)}
      />,
    );
    rerender(
      <CodeModeButton
        location={site}
        proposals={[proposal]}
        codeMode={codeMode(1)}
      />,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
