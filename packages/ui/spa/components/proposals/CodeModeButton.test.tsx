/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("CodeModeButton in a proposal", () => {
  test("off, pressing it turns code mode on", () => {
    const onToggle = jest.fn();
    render(
      <CodeModeButton
        location={inProposal}
        proposals={[proposal]}
        codeMode={{ ...codeMode(0), onToggle }}
      />,
    );
    const button = screen.getByRole("button", { name: "Turn on code mode" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test("on, it is pressed, says who turned it on, and offers the code changes and Turn off", () => {
    const onToggle = jest.fn();
    const onShowCode = jest.fn();
    render(
      <CodeModeButton
        location={inProposal}
        proposals={[proposal]}
        codeMode={{
          ...codeMode(0),
          on: true,
          onToggle,
          onShowCode,
          turnedOn: { by: "Kari Nordmann", ago: "10 minutes ago" },
        }}
      />,
    );
    const button = screen.getByRole("button", { name: "Code mode is on" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button);
    expect(screen.getByRole("menu").textContent).toMatch(
      /Code mode on: turned on by Kari Nordmann, 10 minutes ago/,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Code changes/ }));
    expect(onShowCode).toHaveBeenCalledTimes(1);
    // Looking at the code is one's own; turning it off is everyone's.
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(button);
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Turn off code mode/ }),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("CodeModeButton on the site, where the project lets it change the site's code", () => {
  test("one press opens the site's code mode, with no menu of proposals", () => {
    const onOpenSiteCode = jest.fn();
    const onOpenProposalInCodeMode = jest.fn();
    render(
      <CodeModeButton
        location={site}
        proposals={[proposal]}
        codeMode={{
          ...codeMode(0),
          onOpenSiteCode,
          onOpenProposalInCodeMode,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on code mode" }));
    expect(onOpenSiteCode).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onOpenProposalInCodeMode).not.toHaveBeenCalled();
  });

  test("turned off, it lists proposals as before", () => {
    render(
      <CodeModeButton
        location={site}
        proposals={[proposal]}
        codeMode={codeMode(0)}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Code mode: choose a proposal to change the code in",
      }),
    );
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  test("in the site-code proposal it is the proposal's own switch", () => {
    const onToggle = jest.fn();
    render(
      <CodeModeButton
        location={{ ...inProposal, proposal: { ...proposal, siteCode: true } }}
        proposals={[proposal]}
        codeMode={{ ...codeMode(0), onToggle, onOpenSiteCode: () => {} }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Turn on code mode" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
