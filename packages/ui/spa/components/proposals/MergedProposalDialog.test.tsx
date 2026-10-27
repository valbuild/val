/** @jest-environment jsdom */
// FIRST, and it must stay first: see the note in `testPolyfills`.
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import { MergedProposalDialog } from "./MergedProposalDialog";

/*
 * A merged proposal is finished: nothing saved there is kept and it cannot
 * be published again, so the dialog offers only the ways out of it, and does
 * not close onto it.
 */

const handlers = () => ({
  onOpenContinuation: jest.fn(),
  onNewProposal: jest.fn(),
  onShowAllProposals: jest.fn(),
  onGoToSite: jest.fn(),
});

test("says it is finished, and goes back to the site", () => {
  const h = handlers();
  render(
    <MergedProposalDialog
      open
      displayName="Spring campaign"
      continuedIn={null}
      {...h}
    />,
  );
  expect(screen.getByText("“Spring campaign” is published")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Go to the site/ }));
  expect(h.onGoToSite).toHaveBeenCalledTimes(1);
});

test("has no close button, and Escape does not close it", () => {
  const h = handlers();
  render(
    <MergedProposalDialog
      open
      displayName="Spring campaign"
      continuedIn={null}
      {...h}
    />,
  );
  expect(screen.queryByRole("button", { name: /^Close$/ })).toBeNull();
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  expect(screen.getByText("“Spring campaign” is published")).toBeTruthy();
});

test("with a continuation, carrying on there is the way on", () => {
  const h = handlers();
  render(
    <MergedProposalDialog
      open
      displayName="Spring campaign"
      continuedIn={{ displayName: "Spring campaign (2)" }}
      {...h}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Open “Spring campaign \(2\)”/ }),
  );
  expect(h.onOpenContinuation).toHaveBeenCalledTimes(1);
});

test("without the site's address, no button that cannot work", () => {
  render(
    <MergedProposalDialog
      open
      displayName="Spring campaign"
      continuedIn={null}
      {...handlers()}
      onGoToSite={undefined}
    />,
  );
  expect(screen.queryByRole("button", { name: /Go to the site/ })).toBeNull();
  expect(screen.getByRole("button", { name: /New proposal/ })).toBeTruthy();
});
