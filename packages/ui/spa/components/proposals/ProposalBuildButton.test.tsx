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

  /*
   * A browser that builds in a new tab (Safari, an iPhone), where the tab was
   * not let open -- the assistant's build is no tap. The button opens it.
   */
  test("when the tab could not open, says so and opens it when pressed", () => {
    const onBuild = jest.fn();
    render(
      <ProposalBuildButton
        location={location({ state: "blocked" })}
        onBuild={onBuild}
      />,
    );
    const button = screen.getByRole("button", {
      name: /open the tab to build/i,
    });
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  /*
   * Its dependencies changed without a lockfile to match (valbuild/home
   * `docs/adept.md`, step 6): "Build required: dependencies changed", and the
   * button computes the lockfile.
   */
  test("dependencies changed without a lockfile: it computes the lockfile when pressed", () => {
    const onBuild = jest.fn();
    render(
      <ProposalBuildButton
        location={location({
          state: "lockfile",
          computing: false,
          error: null,
        })}
        onBuild={onBuild}
      />,
    );
    const button = screen.getByRole("button", { name: /compute lockfile/i });
    expect(button.getAttribute("title")).toMatch(
      /build required: dependencies changed/i,
    );
    fireEvent.click(button);
    expect(onBuild).toHaveBeenCalledTimes(1);
  });

  test("says why adept found the lockfile stale, or could not compute it", () => {
    render(
      <ProposalBuildButton
        location={location({
          state: "lockfile",
          computing: false,
          error: "No matching version found for zod@99",
        })}
        onBuild={() => {}}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: /compute lockfile/i })
        .getAttribute("title"),
    ).toContain("No matching version found for zod@99");
  });

  test("cannot be pressed while the lockfile is computed, or the dependencies built", () => {
    const onBuild = jest.fn();
    const { rerender } = render(
      <ProposalBuildButton
        location={location({ state: "lockfile", computing: true, error: null })}
        onBuild={onBuild}
      />,
    );
    const computing = screen.getByRole("button", {
      name: /computing lockfile/i,
    });
    expect(computing.hasAttribute("disabled")).toBe(true);
    rerender(
      <ProposalBuildButton
        location={location({ state: "dependencies-building" })}
        onBuild={onBuild}
      />,
    );
    const building = screen.getByRole("button", {
      name: /building dependencies/i,
    });
    expect(building.hasAttribute("disabled")).toBe(true);
    fireEvent.click(building);
    expect(onBuild).not.toHaveBeenCalled();
  });

  test("dependencies that could not be built say why, and what fixes it, rather than failing again", () => {
    const onBuild = jest.fn();
    render(
      <ProposalBuildButton
        location={location({
          state: "dependencies-failed",
          error: "zod could not be bundled",
        })}
        onBuild={onBuild}
      />,
    );
    const button = screen.getByRole("button", { name: /dependencies failed/i });
    expect(button.getAttribute("title")).toContain("zod could not be bundled");
    expect(button.getAttribute("title")).toMatch(/package\.json/);
    expect(button.hasAttribute("disabled")).toBe(true);
  });
});
