/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProposalSwitcher } from "./ProposalSwitcher";
import type { ProposalSummary, StudioLocation } from "./types";

/*
 * Rename is the switcher's: it changes the name the switcher shows, so it is
 * offered beside it, in a proposal people named.
 */

const proposal: ProposalSummary = {
  name: "a1b2c3d4e5f6a7b8c9d0",
  displayName: "Spring campaign",
  description: null,
  status: "open",
  owner: { name: "Kari Nordmann" },
  ownedByViewer: true,
  changes: 3,
  updatedAt: new Date(0).toISOString(),
};

const inProposal = (over: Partial<ProposalSummary> = {}): StudioLocation => ({
  kind: "proposal",
  proposal: { ...proposal, ...over },
  unsaved: 0,
  save: { state: "idle" },
  overlay: null,
  renderCheck: null,
  publishBlockedBy: null,
  code: null,
});

const handlers = {
  onOpenSite: () => {},
  onOpenProposal: () => {},
  onNewProposal: () => {},
  onShowAllProposals: () => {},
};

test("in a proposal, the switcher renames it", () => {
  const onRename = jest.fn();
  render(
    <ProposalSwitcher
      location={inProposal()}
      proposals={[proposal]}
      {...handlers}
      onRename={onRename}
      defaultOpen
    />,
  );
  fireEvent.click(
    screen.getByRole("menuitem", { name: /Rename “Spring campaign”/ }),
  );
  expect(onRename).toHaveBeenCalledTimes(1);
});

test("not on the site, and not for an upgrade, which Val Build names", () => {
  const { unmount } = render(
    <ProposalSwitcher
      location={{ kind: "site" }}
      proposals={[proposal]}
      {...handlers}
      onRename={() => {}}
      defaultOpen
    />,
  );
  expect(screen.queryByRole("menuitem", { name: /Rename/ })).toBeNull();
  unmount();
  render(
    <ProposalSwitcher
      location={inProposal({ upgrade: true, displayName: "Minor versions" })}
      proposals={[proposal]}
      {...handlers}
      onRename={() => {}}
      defaultOpen
    />,
  );
  expect(screen.queryByRole("menuitem", { name: /Rename/ })).toBeNull();
});

test("while it is not known where this Studio is, it says so and offers nothing", () => {
  render(
    <ProposalSwitcher
      location={{ kind: "site" }}
      proposals={[proposal]}
      {...handlers}
      loading
    />,
  );
  const button = screen.getByRole("button");
  expect(button.textContent).toBe("Loading…");
  expect(button.hasAttribute("disabled")).toBe(true);
});

test("on the way to a proposal, it names where it is going", () => {
  render(
    <ProposalSwitcher
      location={{ kind: "site" }}
      proposals={[proposal]}
      {...handlers}
      leaving="Opening “Spring campaign”…"
    />,
  );
  expect(screen.getByRole("button").textContent).toBe(
    "Opening “Spring campaign”…",
  );
});
