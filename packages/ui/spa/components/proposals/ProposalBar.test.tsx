/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProposalSaveButton } from "./ProposalBar";
import type { StudioLocation } from "./types";

/*
 * Save in a proposal, with changes the schema says are invalid. A save of
 * them is refused by the server ("Cannot publish: some modules have
 * validation errors"), so the button says so first and goes to them, as the
 * site's Publish does.
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

describe("ProposalSaveButton", () => {
  test("with validation errors it is Fix N, and goes to them rather than saving", () => {
    const onSave = jest.fn();
    const onShow = jest.fn();
    render(
      <ProposalSaveButton
        location={location()}
        onSave={onSave}
        blockedBy={{ errors: 2, onShow }}
      />,
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("Fix 2");
    expect(button.getAttribute("title")).toMatch(
      /2 validation errors to fix before saving/,
    );
    fireEvent.click(button);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  test("without them it saves, with the unsaved count", () => {
    const onSave = jest.fn();
    render(
      <ProposalSaveButton
        location={location()}
        onSave={onSave}
        blockedBy={{ errors: 0, onShow: jest.fn() }}
      />,
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("Save3");
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("with nothing unsaved there is nothing to fix before a save: it is off", () => {
    render(
      <ProposalSaveButton
        location={location({ unsaved: 0 })}
        onSave={jest.fn()}
        blockedBy={{ errors: 2, onShow: jest.fn() }}
      />,
    );
    const button = screen.getByRole("button");
    expect(button.textContent).toBe("Save");
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
