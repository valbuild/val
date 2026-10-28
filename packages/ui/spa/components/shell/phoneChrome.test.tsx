/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ProposalSheet } from "../proposals/ProposalSheet";
import type { ProposalSummary, StudioLocation } from "../proposals/types";
import { ChangesSheet } from "./ChangesSheet";
import { TopBar, type TopBarProposals } from "./TopBar";

/**
 * The phone's chrome: one way into each thing, and nothing that has to be
 * squeezed.
 *
 * The phone's top bar used to carry the project name, the proposal switcher
 * and its menu, Members, Validate, History, the bell and the avatar - and in a
 * hosted proposal they overflowed onto each other. What is pinned here is the
 * rule that replaced that: the top bar is where you are, the bottom bar is
 * what you do, and the rest is in the sheet behind the one button that leads
 * to it.
 */
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

const LONG_NAME =
  "Rewrite of all product copy for the spring launch, round two";

const spring: ProposalSummary = {
  name: "a1b2c3",
  displayName: LONG_NAME,
  description: null,
  status: "open",
  owner: { name: "Kari Nordmann" },
  ownedByViewer: true,
  changes: 15,
  updatedAt: "2026-10-06T12:00:00Z",
};
const pricing: ProposalSummary = {
  ...spring,
  name: "b2c3d4",
  displayName: "New pricing page",
  ownedByViewer: false,
  changes: 4,
};

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;
const inSpring = (over: Partial<InProposal> = {}): InProposal => ({
  kind: "proposal",
  proposal: spring,
  unsaved: 3,
  save: { state: "idle" },
  overlay: { status: "succeeded" },
  renderCheck: { status: "succeeded" },
  publishBlockedBy: null,
  code: null,
  ...over,
});

function proposalsAt(
  location: StudioLocation,
  over: Partial<TopBarProposals> = {},
): TopBarProposals {
  return {
    location,
    open: [spring, pricing],
    onOpenSite: jest.fn(),
    onOpenProposal: jest.fn(),
    onNewProposal: jest.fn(),
    onShowAllProposals: jest.fn(),
    onSave: jest.fn(),
    onBuild: jest.fn(),
    onPublish: jest.fn(),
    onCompare: jest.fn(),
    onRename: jest.fn(),
    onCopyLink: jest.fn(),
    onClose: jest.fn(),
    ...over,
  };
}

function phoneTopBar(
  proposals: TopBarProposals | undefined,
  onTogglePanel: (panel: string) => void = () => undefined,
) {
  return (
    <TopBar
      breakpoint="mobile"
      projectName="acme/marketing-site"
      projectHref="https://admin.val.build/~/acme/marketing-site"
      webComponentsUrl="https://content.val.build/wc/v1"
      openPanel={null}
      onTogglePanel={onTogglePanel}
      onOpenMenu={() => undefined}
      onOpenSearch={() => undefined}
      onPreview={() => undefined}
      isCanvasOpen={false}
      onPublish={() => undefined}
      pendingChanges={3}
      unreadNotifications={2}
      historyEnabled
      onOpenHistory={() => undefined}
      onOpenValidate={() => undefined}
      validateCount={4}
      locales={["en", "nb"]}
      onLocaleChange={() => undefined}
      aiEnabled
      user={{ name: "Kari Nordmann" }}
      proposals={proposals}
    />
  );
}

describe("the phone's top bar", () => {
  test("holds the menu, where you are, search and the account - nothing else", () => {
    const { container } = render(phoneTopBar(proposalsAt(inSpring())));
    const header = container.querySelector("header");
    if (header === null) throw new Error("no top bar");
    const labels = within(header)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Open navigation",
      `In the proposal ${LONG_NAME}. Switch`,
      "Search",
      "Account: Kari Nordmann",
    ]);
    expect(container.querySelector("val-project-members")).toBeNull();
    expect(container.querySelector("val-project-switcher")).toBeNull();
  });

  test("never spells out the proposal's name", () => {
    render(phoneTopBar(proposalsAt(inSpring())));
    expect(screen.queryByText(LONG_NAME)).toBeNull();
  });

  test("its location chip opens the proposal sheet", () => {
    const toggled: string[] = [];
    render(
      phoneTopBar(proposalsAt(inSpring()), (panel) => toggled.push(panel)),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: `In the proposal ${LONG_NAME}. Switch`,
      }),
    );
    expect(toggled).toEqual(["proposals"]);
  });

  test("offers the account even with nobody signed in", () => {
    // The theme, auto save and the deploy feed are behind it, and nothing
    // else on a phone leads there.
    render(
      <TopBar
        breakpoint="mobile"
        projectName="Test"
        openPanel={null}
        onTogglePanel={() => undefined}
        onOpenMenu={() => undefined}
        onOpenSearch={() => undefined}
        onPreview={() => undefined}
        isCanvasOpen={false}
        onPublish={() => undefined}
        pendingChanges={0}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Account and settings" }),
    ).not.toBeNull();
  });
});

describe("the proposal sheet", () => {
  test("names the proposal in full", () => {
    render(
      <ProposalSheet
        breakpoint="mobile"
        proposals={proposalsAt(inSpring())}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(LONG_NAME)).not.toBeNull();
    expect(screen.getByText("You · 15 changes · 3 unsaved")).not.toBeNull();
  });

  test("carries the proposal's own acts, and Publish is not one of them", () => {
    const proposals = proposalsAt(inSpring());
    const onClose = jest.fn();
    render(
      <ProposalSheet
        breakpoint="mobile"
        proposals={proposals}
        onClose={onClose}
      />,
    );
    for (const name of [
      "Compare with the site",
      "Rename…",
      "Copy link",
      "Close…",
    ]) {
      expect(screen.getByRole("button", { name })).not.toBeNull();
    }
    expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rename…" }));
    expect(proposals.onRename).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("opens the design tab, as the switcher's menu does above a phone", () => {
    const onOpenDesign = jest.fn();
    const onClose = jest.fn();
    render(
      <ProposalSheet
        breakpoint="mobile"
        proposals={{ ...proposalsAt(inSpring()), onOpenDesign }}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Open design tab/ }));
    expect(onOpenDesign).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("offers no design tab where the site's address is not known", () => {
    render(
      <ProposalSheet
        breakpoint="mobile"
        proposals={proposalsAt(inSpring())}
        onClose={() => undefined}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Open design tab/ }),
    ).toBeNull();
  });

  test("switches to the site and the other proposals, not to itself", () => {
    const proposals = proposalsAt(inSpring());
    render(
      <ProposalSheet
        breakpoint="mobile"
        proposals={proposals}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /New pricing page/ }));
    expect(proposals.onOpenProposal).toHaveBeenCalledWith("b2c3d4");
    expect(screen.getAllByText(LONG_NAME)).toHaveLength(1);
    expect(screen.getByRole("button", { name: /The site/ })).not.toBeNull();
  });

  test("on the site, it is the way into a proposal", () => {
    const proposals = proposalsAt({ kind: "site" });
    render(
      <ProposalSheet
        breakpoint="mobile"
        proposals={proposals}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "Rename…" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /spring launch/ }));
    expect(proposals.onOpenProposal).toHaveBeenCalledWith("a1b2c3");
  });
});

describe("the changes sheet", () => {
  test("in a proposal: Save, Review, Build and Publish", () => {
    const proposals = proposalsAt(inSpring({ code: { state: "required" } }));
    render(
      <ChangesSheet
        breakpoint="mobile"
        proposals={proposals}
        onCompare={() => undefined}
        pendingChanges={18}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: /^Save/ })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /Review 18 changes/ }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Build/ })).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Publish to the site/ }),
    );
    expect(proposals.onPublish).toHaveBeenCalledTimes(1);
  });

  test("a save refused for errors says how many, and leads to them", () => {
    const onShow = jest.fn();
    render(
      <ChangesSheet
        breakpoint="mobile"
        proposals={proposalsAt(inSpring(), {
          saveBlockedBy: { errors: 2, onShow },
        })}
        pendingChanges={3}
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Fix 2 validation errors/ }),
    );
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  test("a publish that cannot happen says why, beside it", () => {
    render(
      <ChangesSheet
        breakpoint="mobile"
        proposals={proposalsAt(
          inSpring({ publishBlockedBy: "Not until the build is done" }),
        )}
        pendingChanges={3}
        onClose={() => undefined}
      />,
    );
    const publish = screen.getByRole("button", {
      name: /Publish to the site/,
    });
    expect(publish.hasAttribute("disabled")).toBe(true);
    expect(
      within(publish).getByText("Not until the build is done"),
    ).not.toBeNull();
  });

  test("on the site: Review, and nothing of a proposal's", () => {
    render(
      <ChangesSheet
        breakpoint="mobile"
        onCompare={() => undefined}
        pendingChanges={12}
        onClose={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Review 12 changes/ }),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  });
});
