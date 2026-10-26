/** @jest-environment jsdom */
import "../../stores/react/testPolyfills";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  PublishProposalDialog,
  type PublishProposalState,
  type UpdateConflictView,
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

/*
 * A proposal with dependencies of its own (valbuild/home `docs/adept.md`,
 * step 6 and decision 20): its own checks say what to do, and nobody else is
 * asked for anything.
 */
describe("Publish, blocked by the proposal's dependencies", () => {
  test("a lockfile to compute: the check offers it, and nobody is asked", () => {
    const onComputeLockfile = jest.fn();
    render(
      <PublishProposalDialog
        open
        onOpenChange={() => {}}
        displayName="Spring"
        state={ready([
          {
            id: "dependencies",
            ok: false,
            message:
              "This proposal's dependencies changed: compute the lockfile",
            action: "compute-lockfile",
          },
        ])}
        onPublish={() => {}}
        onRetry={() => {}}
        onComputeLockfile={onComputeLockfile}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /compute lockfile/i }));
    expect(onComputeLockfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Ask them to publish/)).toBeNull();
  });

  test("no typecheck yet: the check runs one, and says so while it does", () => {
    const onTypecheck = jest.fn();
    const checks = ready([
      {
        id: "types",
        ok: false,
        message: "Typecheck required",
        action: "typecheck",
      },
    ]);
    const { rerender } = render(
      <PublishProposalDialog
        open
        onOpenChange={() => {}}
        displayName="Spring"
        state={checks}
        onPublish={() => {}}
        onRetry={() => {}}
        onTypecheck={onTypecheck}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^typecheck$/i }));
    expect(onTypecheck).toHaveBeenCalledTimes(1);
    rerender(
      <PublishProposalDialog
        open
        onOpenChange={() => {}}
        displayName="Spring"
        state={checks}
        onPublish={() => {}}
        onRetry={() => {}}
        onTypecheck={onTypecheck}
        typechecking
      />,
    );
    const running = screen.getByRole("button", { name: /typechecking/i });
    expect(running.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/Ask them to publish/)).toBeNull();
  });

  test("new type errors, or dependencies being built, are not someone else's to clear", () => {
    dialog(
      ready([
        { id: "types", ok: false, message: "2 new type errors" },
        {
          id: "dependencies",
          ok: false,
          message: "This proposal's dependencies are being built",
        },
      ]),
    );
    expect(screen.getByText("2 new type errors")).toBeTruthy();
    expect(screen.queryByText(/Ask them to publish/)).toBeNull();
  });
});

describe("Update from the site, with conflicts (step 8.2)", () => {
  const withConflicts = (
    conflicts?: UpdateConflictView[],
  ): PublishProposalState => ({
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
    conflicts: conflicts ?? [
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

  test("a file both changed is one decision, each side said by what it did to the file", () => {
    const resolve = jest.fn();
    dialog(
      withConflicts([
        {
          kind: "code",
          file: "src/components/Hero.tsx",
          base: "a\nb\nc",
          site: "a\nB\nc",
          proposal: null,
        },
      ]),
      () => {},
      false,
      { onResolve: resolve },
    );
    expect(screen.getByText("src/components/Hero.tsx")).toBeTruthy();
    expect(screen.getByText("changed (+1 −1 lines)")).toBeTruthy();
    expect(screen.getByText("deleted")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(
      screen.getByRole("button", { name: /update from the site/i }),
    );
    expect(resolve).toHaveBeenCalledWith(["proposal"]);
  });

  test("a new list of conflicts starts undecided: no choice carries over by position", () => {
    const view = dialog(withConflicts(), () => {}, false, {
      onResolve: () => {},
    });
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[0]);
    fireEvent.click(radios[3]);
    // The next answer is a code round, with one other conflict.
    view.rerender(
      <PublishProposalDialog
        open
        onOpenChange={() => {}}
        displayName="Spring"
        state={withConflicts([
          {
            kind: "code",
            file: "src/components/Hero.tsx",
            base: "a",
            site: "b",
            proposal: "c",
          },
        ])}
        onPublish={() => {}}
        onRetry={() => {}}
        onResolve={() => {}}
      />,
    );
    const update = screen.getByRole("button", {
      name: /update from the site/i,
    });
    if (!(update instanceof HTMLButtonElement)) throw new Error("not a button");
    expect(update.disabled).toBe(true);
    for (const radio of screen.getAllByRole("radio")) {
      if (!(radio instanceof HTMLInputElement)) throw new Error("not a radio");
      expect(radio.checked).toBe(false);
    }
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

describe("Update from the site, failing", () => {
  test("says the update failed, not the checks, and Try again retries it", () => {
    const retry = jest.fn();
    render(
      <PublishProposalDialog
        open
        onOpenChange={() => {}}
        displayName="Spring"
        state={{
          kind: "error",
          message: "Val Build could not be reached",
          update: { checkId: "published-since" },
        }}
        onPublish={() => {}}
        onRetry={retry}
      />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not update it from the site: Val Build could not be reached.",
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test("offers no Try again when trying again here cannot help", () => {
    render(
      <PublishProposalDialog
        open
        onOpenChange={() => {}}
        displayName="Spring"
        state={{
          kind: "error",
          message:
            "Open the proposal in Chrome or Edge on a computer to update it.",
          update: { checkId: null },
        }}
        onPublish={() => {}}
        onRetry={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });
});
