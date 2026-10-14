/** @jest-environment jsdom */
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  PublishProposalDialog,
  type PublishProposalState,
} from "./PublishProposalDialog";

/*
 * What blocks Publish, and what the person can do about it (valbuild/home
 * `docs/hosted-publishing.md`, step 8). The site's code changing under the
 * proposal is cleared from here; someone else's changes are not.
 */
const ready = (
  checks: Extract<PublishProposalState, { kind: "ready" }>["checks"],
): PublishProposalState => ({ kind: "ready", checks, changes: 2, unsaved: 0 });

const dialog = (
  state: PublishProposalState,
  onUpdateFromSite = () => {},
  updating = false,
) =>
  render(
    <PublishProposalDialog
      open
      onOpenChange={() => {}}
      displayName="Spring"
      state={state}
      onPublish={() => {}}
      onRetry={() => {}}
      onUpdateFromSite={onUpdateFromSite}
      updating={updating}
    />,
  );

describe("Publish, blocked", () => {
  test("by the site's code: Update from the site is offered beside the reason, and not 'ask them'", () => {
    const update = jest.fn();
    dialog(
      ready([
        { id: "published-since", ok: true, message: "Nobody has published" },
        {
          id: "site-code",
          ok: false,
          message: "The site's code changed after this proposal started",
          action: "update-from-site",
        },
      ]),
      update,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /update from the site/i }),
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Ask them to publish/)).toBeNull();
  });

  test("while it updates, it says so and cannot be pressed twice", () => {
    const update = jest.fn();
    dialog(
      ready([
        {
          id: "site-code",
          ok: false,
          message: "m",
          action: "update-from-site",
        },
      ]),
      update,
      true,
    );
    const button = screen.getByRole("button", {
      name: /updating from the site/i,
    });
    if (!(button instanceof HTMLButtonElement)) throw new Error("not a button");
    expect(button.disabled).toBe(true);
  });

  test("by someone else's changes: they are asked, and nothing here offers to clear it", () => {
    dialog(
      ready([
        {
          id: "published-since",
          ok: false,
          message: "Jonas changed title on /content/page.val.ts",
        },
      ]),
    );
    expect(screen.getByText(/Ask them to publish/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /update from the site/i }),
    ).toBeNull();
  });
});
