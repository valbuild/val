/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { Shell } from "./Shell";
import { mockSelectionIds, mockShellData } from "./mockShellData";
import { TooltipProvider } from "../designSystem/tooltip";
import { ValPortalProvider } from "../ValPortalProvider";
import { ValThemeProvider } from "../ValThemeProvider";
import type { TopBarProposals } from "./TopBar";
import type { StudioLocation } from "../proposals/types";

// The worker behind validation, which jest cannot load; nothing here validates.
jest.mock("../../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));

// ESM-only, which this jest setup does not transform.
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

/**
 * The phone's one action in a proposal, where Save updates the preview too:
 * Save while there is something to save, and Publish once there is not --
 * the same rule as the split button above a phone (`nextProposalAction`).
 * Publish opens the publish dialog, which asks before anything is published.
 */
beforeAll(() => {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: 390,
  });
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
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

type InProposal = Extract<StudioLocation, { kind: "proposal" }>;
const inProposal = (over: Partial<InProposal> = {}): InProposal => ({
  kind: "proposal",
  proposal: {
    name: "a1b2c3",
    displayName: "Spring campaign",
    description: null,
    status: "open",
    owner: { name: "Kari Nordmann" },
    ownedByViewer: true,
    changes: 15,
    updatedAt: "2026-10-06T12:00:00Z",
  },
  unsaved: 0,
  save: { state: "idle" },
  overlay: { status: "succeeded" },
  renderCheck: { status: "succeeded" },
  publishBlockedBy: null,
  code: null,
  ...over,
});

function proposalsAt(
  location: InProposal,
  over: Partial<TopBarProposals> = {},
): TopBarProposals {
  return {
    location,
    open: [location.proposal],
    onOpenSite: jest.fn(),
    onOpenProposal: jest.fn(),
    onNewProposal: jest.fn(),
    onShowAllProposals: jest.fn(),
    onSave: jest.fn(),
    onBuild: jest.fn(),
    onSaveAndBuild: jest.fn(),
    onPublish: jest.fn(),
    onCompare: jest.fn(),
    onRename: jest.fn(),
    onCopyLink: jest.fn(),
    onClose: jest.fn(),
    ...over,
  };
}

function phone(proposals: TopBarProposals) {
  return (
    <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <Shell
            data={mockShellData}
            theme="dark"
            onThemeChange={() => undefined}
            initialSelectionId={mockSelectionIds.home}
            proposals={proposals}
            skipTransition
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>
  );
}

test("with everything saved, the phone's action is Publish", () => {
  const proposals = proposalsAt(inProposal());
  render(phone(proposals));
  expect(screen.queryByRole("button", { name: /^Save/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Publish/ }));
  expect(proposals.onPublish).toHaveBeenCalledTimes(1);
  expect(proposals.onSaveAndBuild).not.toHaveBeenCalled();
});

test("with something to save, it is Save, which updates the preview too", () => {
  const proposals = proposalsAt(inProposal({ unsaved: 2 }));
  render(phone(proposals));
  expect(screen.queryByRole("button", { name: /^Publish/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Save/ }));
  expect(proposals.onSaveAndBuild).toHaveBeenCalledTimes(1);
});

test("with everything saved and validation errors, it is Fix N", () => {
  const onShow = jest.fn();
  const proposals = proposalsAt(inProposal(), {
    saveBlockedBy: { errors: 3, onShow },
  });
  render(phone(proposals));
  fireEvent.click(screen.getByRole("button", { name: /^Fix 3/ }));
  expect(onShow).toHaveBeenCalledTimes(1);
  expect(proposals.onPublish).not.toHaveBeenCalled();
});
