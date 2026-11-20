/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Shell } from "./Shell";
import { mockSelectionIds, mockShellData } from "./mockShellData";
import { mockCanvasPage } from "./canvas/mockCanvasPage";
import { TooltipProvider } from "../designSystem/tooltip";
import { ValPortalProvider } from "../ValPortalProvider";
import { ValThemeProvider } from "../ValThemeProvider";
import { PhonePaneBar } from "./workspace/PhonePaneBar";

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
 * The phone's panes.
 *
 * The Sketchpad's Build, on a phone, puts the conversation it starts in
 * front.
 *
 * Build opens the assistant the way the Studio opens any panel from outside
 * the shell: a view state to adopt (`restoreViewState`), with the panel and
 * the canvas as they are. A Sketchpad holds the canvas open, and the
 * adoption used to set the phone's pane from the canvas after the panel, so
 * the phone landed on the Preview instead of the assistant.
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
  // jsdom has no layout, and the panes measure themselves.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

type ShellProps = ComponentProps<typeof Shell>;

function shell(restoreViewState?: ShellProps["restoreViewState"]) {
  return (
    <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <Shell
            data={mockShellData}
            theme="dark"
            onThemeChange={() => undefined}
            initialSelectionId={mockSelectionIds.home}
            aiEnabled
            aiSlot={<div>The conversation</div>}
            canvasPage={mockCanvasPage}
            sketchPane={<div>The sketch</div>}
            restoreViewState={restoreViewState}
            skipTransition
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>
  );
}

function paneShown(
  name: "Content" | "Sketch" | "Preview" | "Assistant",
): string | null {
  return within(screen.getByRole("navigation", { name: "Workspace panes" }))
    .getByRole("button", { name })
    .getAttribute("aria-current");
}

test("Build on the Sketch pane puts the Assistant in front", () => {
  const view = render(shell());
  // A sketch opens in front, with the preview held open behind it.
  expect(paneShown("Sketch")).toBe("page");

  // What `openAIPanel` in `ValShell` hands the shell.
  view.rerender(
    shell({ epoch: 1, panel: "ai", canvasOpen: true, canvasView: "normal" }),
  );
  expect(paneShown("Assistant")).toBe("page");
  expect(paneShown("Preview")).toBeNull();
});

/**
 * The phone's panes sit side by side in the pane bar's order, and moving
 * between them slides that strip (`phoneTrack`): the Assistant and the
 * Sketch as Content and the Preview always have. Off to one side, a pane
 * is out of reach.
 */
test("the panes are Content, Preview, Assistant, Sketch, side by side", () => {
  render(shell());
  const bar = screen.getByRole("navigation", { name: "Workspace panes" });
  expect(
    within(bar)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label")),
    // And full screen at the end, which is not a pane.
  ).toEqual(["Content", "Preview", "Assistant", "Sketch", "Full screen"]);

  // The sketch is in front; the assistant one pane to its left, out of reach.
  const assistant = document.querySelector(
    '[role="dialog"][aria-label="AI assistant"]',
  );
  if (!(assistant instanceof HTMLElement)) {
    throw new Error("No assistant pane");
  }
  expect(assistant.style.transform).toContain("-1");
  expect(assistant.hasAttribute("inert")).toBe(true);

  fireEvent.click(within(bar).getByRole("button", { name: "Assistant" }));
  expect(assistant.style.transform).toBe("translateX(0)");
  expect(assistant.hasAttribute("inert")).toBe(false);
  const sketch = document.querySelector('[data-val-pane="sketch"]');
  if (!(sketch instanceof HTMLElement)) throw new Error("No sketch pane");
  expect(sketch.style.transform).toContain("1 *");
  expect(sketch.hasAttribute("inert")).toBe(true);
});

/**
 * On a phone the assistant is a pane like the others: the pane bar moves
 * away from it, and nothing closes it -- no X, and Escape leaves it be.
 */
test("the Assistant pane has no close button, and Escape leaves it open", () => {
  render(shell());
  const bar = screen.getByRole("navigation", { name: "Workspace panes" });
  fireEvent.click(within(bar).getByRole("button", { name: "Assistant" }));
  expect(
    screen.queryByRole("button", { name: "Close AI assistant" }),
  ).toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(paneShown("Assistant")).toBe("page");
  expect(screen.getByText("The conversation")).toBeTruthy();
});

/**
 * Full screen: the top bar goes, the pane bar stays -- smaller -- with every
 * pane still on it, and the panes reach up where the top bar was
 * (`phoneInsets`). Left from the same button.
 */
test("full screen takes the top bar away and keeps every pane a tap away", () => {
  render(shell());
  const bar = screen.getByRole("navigation", { name: "Workspace panes" });
  const fullScreen = within(bar).getByRole("button", { name: "Full screen" });
  const root = screen
    .getByRole("navigation", { name: "Workspace panes" })
    .closest("[data-mode]");
  if (!(root instanceof HTMLElement)) throw new Error("No shell");
  expect(screen.getByRole("button", { name: "Open navigation" })).toBeTruthy();
  expect(root.style.getPropertyValue("--val-phone-top")).toBe("4.5rem");

  fireEvent.click(fullScreen);
  expect(fullScreen.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("button", { name: "Open navigation" })).toBeNull();
  expect(root.style.getPropertyValue("--val-phone-top")).not.toBe("4.5rem");
  fireEvent.click(within(bar).getByRole("button", { name: "Assistant" }));
  expect(paneShown("Assistant")).toBe("page");

  fireEvent.click(fullScreen);
  expect(fullScreen.getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: "Open navigation" })).toBeTruthy();
  expect(root.style.getPropertyValue("--val-phone-top")).toBe("4.5rem");
});

/**
 * What the avatar's dot says -- an error, a notification -- goes with the
 * top bar in full screen, so the way out says it instead.
 */
test("in full screen, the way out says when something is waiting", () => {
  const bar = (fullScreen: boolean) => (
    <PhonePaneBar
      shown="content"
      panes={[{ pane: "content", onShow: () => undefined }]}
      fullScreen={fullScreen}
      onFullScreenChange={() => undefined}
      attention
    />
  );
  const view = render(bar(false));
  const button = screen.getByRole("button", { name: "Full screen" });
  expect(button.getAttribute("aria-description")).toBeNull();
  view.rerender(bar(true));
  expect(button.getAttribute("aria-description")).toBe(
    "Something is waiting in your account",
  );
});
