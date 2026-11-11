/** @jest-environment jsdom */
import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { Shell } from "./Shell";
import { mockSelectionIds, mockShellData } from "./mockShellData";
import { mockCanvasPage } from "./canvas/mockCanvasPage";
import { TooltipProvider } from "../designSystem/tooltip";
import { ValPortalProvider } from "../ValPortalProvider";
import { ValThemeProvider } from "../ValThemeProvider";

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

function paneShown(name: "Sketch" | "Preview" | "Assistant"): string | null {
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
