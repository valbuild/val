/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ProposalActionButton,
  nextProposalAction,
  proposalProgress,
} from "./ProposalBar";
import type { StudioLocation } from "./types";

/*
 * Save, Build and Publish above a phone: one split button where Publish is on
 * the site. Its main half is the step that comes next, so Save becomes
 * Publish once everything is saved, and the caret offers Publish at any time.
 */

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;
const location = (over: Partial<InProposal> = {}): InProposal => ({
  kind: "proposal",
  proposal: {
    name: "a1b2c3d4e5f6a7b8c9d0",
    displayName: "Spring campaign",
    description: null,
    status: "open",
    owner: { name: "Kari Nordmann" },
    ownedByViewer: true,
    changes: 3,
    updatedAt: new Date(0).toISOString(),
  },
  unsaved: 3,
  save: { state: "idle" },
  overlay: { status: "succeeded" },
  renderCheck: { status: "succeeded" },
  publishBlockedBy: null,
  code: null,
  ...over,
});

const handlers = () => ({
  onSave: jest.fn(),
  onBuild: jest.fn(),
  onPublish: jest.fn(),
  onRename: jest.fn(),
  onCopyLink: jest.fn(),
  onClose: jest.fn(),
});

describe("nextProposalAction", () => {
  test("save, then build, then publish", () => {
    expect(nextProposalAction(location(), true)).toBe("save");
    expect(
      nextProposalAction(
        location({ unsaved: 0, code: { state: "required" } }),
        true,
      ),
    ).toBe("build");
    expect(nextProposalAction(location({ unsaved: 0 }), true)).toBe("publish");
  });

  test("a save running or failed stays the next step", () => {
    expect(
      nextProposalAction(
        location({ unsaved: 0, save: { state: "saving" } }),
        true,
      ),
    ).toBe("save");
  });

  test("code that is not built here does not stand in Publish's way", () => {
    expect(
      nextProposalAction(
        location({ unsaved: 0, code: { state: "required" } }),
        false,
      ),
    ).toBe("publish");
  });
});

describe("ProposalActionButton", () => {
  test("with unsaved changes the main half saves", () => {
    const h = handlers();
    render(<ProposalActionButton location={location()} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
    expect(h.onSave).toHaveBeenCalledTimes(1);
    expect(h.onPublish).not.toHaveBeenCalled();
  });

  test("the caret publishes directly, saving first", () => {
    const h = handlers();
    render(<ProposalActionButton location={location()} {...h} />);
    fireEvent.click(
      screen.getByRole("button", { name: "More for this proposal" }),
    );
    const publish = screen.getByRole("menuitem", {
      name: /Publish to the site/,
    });
    expect(publish.textContent).toMatch(/Saves the changes first/);
    fireEvent.click(publish);
    expect(h.onPublish).toHaveBeenCalledTimes(1);
    expect(h.onSave).not.toHaveBeenCalled();
  });

  test("once everything is saved, Save has become Publish", () => {
    const h = handlers();
    render(<ProposalActionButton location={location({ unsaved: 0 })} {...h} />);
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Publish/ }));
    expect(h.onPublish).toHaveBeenCalledTimes(1);
  });

  test("a refused Publish says why in the menu, not only on hover", () => {
    render(
      <ProposalActionButton
        location={location({
          unsaved: 0,
          publishBlockedBy: "It is being brought up to date with the site.",
        })}
        {...handlers()}
        defaultMenuOpen
      />,
    );
    const publish = screen.getByRole("menuitem", {
      name: /Publish to the site/,
    });
    expect(publish.hasAttribute("disabled")).toBe(true);
    expect(publish.textContent).toMatch(/brought up to date with the site/);
  });

  test("with validation errors the caret does not publish what cannot be saved", () => {
    render(
      <ProposalActionButton
        location={location()}
        {...handlers()}
        saveBlockedBy={{ errors: 2, onShow: () => {} }}
        defaultMenuOpen
      />,
    );
    expect(
      screen
        .getByRole("menuitem", { name: /Publish to the site/ })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  test("a published proposal says so, and its menu keeps the proposal's acts", () => {
    const h = handlers();
    render(
      <ProposalActionButton
        location={location({
          unsaved: 0,
          proposal: { ...location().proposal, status: "merged" },
        })}
        {...h}
        defaultMenuOpen
      />,
    );
    const button = screen.getByRole("button", { name: /Published/ });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("menuitem", { name: /Publish to/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Copy link/ }));
    expect(h.onCopyLink).toHaveBeenCalledTimes(1);
  });
});

describe("the proposal's acts, in the same menu", () => {
  test("compare, rename, copy its link and close sit below the steps", () => {
    const h = handlers();
    render(
      <ProposalActionButton
        location={location()}
        {...h}
        onCompare={() => {}}
        defaultMenuOpen
      />,
    );
    const items = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
    expect(items.map((text) => text.split(/(?=[A-Z])/)[0])).toEqual([
      "Save 3 changes",
      "Publish to the site",
      "Compare with the site",
      "Rename…",
      "Copy link",
      "Close…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Close/ }));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  test("an upgrade is discarded, and not renamed", () => {
    render(
      <ProposalActionButton
        location={location({
          unsaved: 0,
          proposal: { ...location().proposal, upgrade: true, changes: 0 },
        })}
        {...handlers()}
        defaultMenuOpen
      />,
    );
    expect(screen.queryByRole("menuitem", { name: /Rename/ })).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: /Discard upgrade/ }),
    ).toBeTruthy();
  });
});

describe("proposalProgress", () => {
  test("nothing to say once the address has caught up", () => {
    expect(proposalProgress(location())).toBeNull();
  });

  test("a save being applied to the address, then checked", () => {
    expect(
      proposalProgress(location({ overlay: { status: "running" } }))?.label,
    ).toBe("Updating the preview…");
    expect(
      proposalProgress(
        location({
          overlay: { status: "succeeded" },
          renderCheck: { status: "running" },
        }),
      )?.label,
    ).toBe("Checking the preview…");
  });

  test("a failed render check is said, with why", () => {
    const progress = proposalProgress(
      location({
        renderCheck: { status: "failed", error: "/products returned 500" },
      }),
    );
    expect(progress?.busy).toBe(false);
    expect(progress?.detail).toMatch(/\/products returned 500/);
  });
});
