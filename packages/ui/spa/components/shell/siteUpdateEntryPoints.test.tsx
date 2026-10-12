/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { MobileBottomBar } from "./MobileChrome";
import { UtilityPanel } from "./UtilityPanel";

/**
 * Where a site update is found: a badge on Quick actions, in the top bar and
 * on a phone's bottom bar, and the Show updates row inside the panel, which
 * carries the same badge. The dialog itself is `siteUpdateDialog.test.tsx`.
 */

function topBar(props: Partial<Parameters<typeof TopBar>[0]> = {}) {
  return (
    <TopBar
      breakpoint="desktop"
      projectName="acme/marketing-site"
      openPanel={null}
      onTogglePanel={() => undefined}
      onOpenMenu={() => undefined}
      onOpenSearch={() => undefined}
      onPreview={() => undefined}
      onCompare={() => undefined}
      onPublish={() => undefined}
      pendingChanges={0}
      reviewCount={0}
      {...props}
    />
  );
}

describe("the Quick actions button", () => {
  test("carries no badge and its plain name when there is no update", () => {
    render(topBar());
    expect(
      screen.getByRole("button", { name: "Quick actions" }),
    ).not.toBeNull();
    expect(screen.queryByTestId("site-update-badge")).toBeNull();
  });

  test("in the top bar, counts the packages an update moves", () => {
    render(topBar({ quickActionsIndicator: { kind: "count", count: 12 } }));
    const button = screen.getByRole("button", {
      name: "Quick actions (12 updates available)",
    });
    expect(button.textContent).toBe("9+");
  });

  test("on a phone, carries the same badge", () => {
    render(
      <MobileBottomBar
        pendingChanges={0}
        onPreview={() => undefined}
        onPublish={() => undefined}
        onOpenStatus={() => undefined}
        onOpenQuickActions={() => undefined}
        quickActionsIndicator={{ kind: "count", count: 3 }}
      />,
    );
    const button = screen.getByRole("button", {
      name: "Quick actions (3 updates available)",
    });
    expect(button.textContent).toBe("3");
  });
});

describe("the Show updates row", () => {
  const panel = (props: Partial<Parameters<typeof UtilityPanel>[0]> = {}) => (
    <UtilityPanel
      breakpoint="desktop"
      activity={[]}
      onNewPage={() => undefined}
      onUploadMedia={() => undefined}
      onClose={() => undefined}
      onSelectActivity={() => undefined}
      {...props}
    />
  );

  test("is first among the quick actions, with the badge, and opens the dialog", () => {
    const opened: string[] = [];
    render(
      panel({
        siteUpdate: {
          label: "Show updates",
          indicator: { kind: "count", count: 12 },
          onOpen: () => opened.push("dialog"),
        },
      }),
    );
    const row = screen.getByRole("button", { name: /Show updates/ });
    expect(row.textContent).toContain("9+");
    const buttons = screen.getAllByRole("button");
    const newPage = screen.getByRole("button", { name: "New page" });
    expect(buttons.indexOf(row)).toBeLessThan(buttons.indexOf(newPage));
    fireEvent.click(row);
    expect(opened).toEqual(["dialog"]);
  });

  test("is not there without an update", () => {
    render(panel());
    expect(screen.queryByRole("button", { name: /Show updates/ })).toBeNull();
  });
});
