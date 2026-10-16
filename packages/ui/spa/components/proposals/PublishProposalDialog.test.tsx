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
  onUpdateFromSite: (checkId: string) => void = () => {},
  updating = false,
  more: {
    onResolve?: (keep: ("site" | "proposal")[]) => void;
    onCancelUpdate?: () => void;
  } = {},
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
      {...more}
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
    expect(update).toHaveBeenCalledWith("site-code");
    expect(screen.queryByText(/Ask them to publish/)).toBeNull();
  });

  test("by a page the site published since: Update from the site is offered, for that check", () => {
    const update = jest.fn();
    dialog(
      ready([
        {
          id: "published-since",
          ok: false,
          message: "Jonas changed title on /content/page.val.ts",
          action: "update-from-site",
        },
      ]),
      update,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /update from the site/i }),
    );
    expect(update).toHaveBeenCalledWith("published-since");
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

describe("Update from the site, with conflicts (step 8.2)", () => {
  const withConflicts = (): PublishProposalState => ({
    kind: "ready",
    changes: 1,
    unsaved: 0,
    checks: [
      {
        id: "published-since",
        ok: false,
        message: "Jonas changed title on /content/page.val.ts",
        action: "update-from-site",
      },
    ],
    conflicts: [
      {
        kind: "field",
        moduleFilePath: "/content/page.val.ts",
        path: ["title"],
        site: "Spring sale",
        proposal: "Summer sale",
      },
      {
        kind: "field",
        moduleFilePath: "/content/page.val.ts",
        path: ["subtitle"],
        site: "Fresh",
        proposal: "Fresh",
      },
    ],
  });

  test("each is shown with both sides, and nothing merges until every one is decided", () => {
    const resolve = jest.fn();
    dialog(withConflicts(), () => {}, false, { onResolve: resolve });
    expect(screen.getByText("content/page.val.ts › title")).toBeTruthy();
    // The same value on both sides is a conflict too: an easy one.
    expect(screen.getAllByText("Fresh")).toHaveLength(2);
    const update = screen.getByRole("button", {
      name: /update from the site/i,
    });
    if (!(update instanceof HTMLButtonElement)) throw new Error("not a button");
    expect(update.disabled).toBe(true);

    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]); // title: the site's
    expect(update.disabled).toBe(true);
    fireEvent.click(radios[3]); // subtitle: this proposal's
    expect(update.disabled).toBe(false);
    fireEvent.click(update);
    expect(resolve).toHaveBeenCalledWith(["site", "proposal"]);
  });

  test("Not now leaves them undecided, and merges nothing", () => {
    const resolve = jest.fn();
    const cancel = jest.fn();
    dialog(withConflicts(), () => {}, false, {
      onResolve: resolve,
      onCancelUpdate: cancel,
    });
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
  });
});
