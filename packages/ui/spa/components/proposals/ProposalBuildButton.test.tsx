/** @jest-environment jsdom */
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProposalBuildButton } from "./ProposalBar";
import type { ProposalCodeState, StudioLocation } from "./types";

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;
const location = (code: ProposalCodeState | null): InProposal => ({
  kind: "proposal",
  proposal: {
    name: "0123456789abcdef0123",
    displayName: "Spring",
    description: null,
    status: "open",
    owner: null,
    ownedByViewer: true,
    changes: 0,
    updatedAt: "2026-10-14T10:00:00.000Z",
  },
  unsaved: 0,
  save: { state: "idle" },
  overlay: null,
  renderCheck: null,
  publishBlockedBy: null,
  code,
});

/*
 * Build, in a proposal with staged code (valbuild/home
 * `docs/hosted-publishing.md`, step 7): shown only while there is something to
 * build, and a failed build says why and builds again when pressed.
 */
describe("the Build button", () => {
  test("is not there when there is nothing to build", () => {
    const { container } = render(
      <ProposalBuildButton location={location(null)} onBuild={() => {}} />,
    );
    expect(container.childElementCount).toBe(0);
  });

  test("says a build is required, and builds when pressed", () => {
    const onBuild = jest.fn();
    render(
      <ProposalBuildButton
        location={location({ state: "required" })}
        onBuild={onBuild}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /build required/i }));
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  test("cannot be pressed again while building", () => {
    const onBuild = jest.fn();
    render(
      <ProposalBuildButton
        location={location({ state: "building" })}
        onBuild={onBuild}
      />,
    );
    const button = screen.getByRole("button", { name: /building/i });
    if (!(button instanceof HTMLButtonElement)) throw new Error("not a button");
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onBuild).not.toHaveBeenCalled();
  });

  test("a failed build says why, and builds again when pressed", () => {
    const onBuild = jest.fn();
    render(
      <ProposalBuildButton
        location={location({ state: "failed", error: "Unexpected token" })}
        onBuild={onBuild}
      />,
    );
    const button = screen.getByRole("button", { name: /build failed/i });
    expect(button.getAttribute("title")).toContain("Unexpected token");
    expect(button.getAttribute("title")).toMatch(/build again/i);
    fireEvent.click(button);
    expect(onBuild).toHaveBeenCalledTimes(1);
  });
});
