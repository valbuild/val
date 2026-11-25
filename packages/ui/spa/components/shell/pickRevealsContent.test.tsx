/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
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
 * A pick on the page opens its field in Content, so Content has to be on
 * screen afterwards.
 *
 * Content can be switched off from the top bar to look at the page alone,
 * and Select stays on while it is. A pick then opened the field in a column
 * nobody could see: the click looked like it had done nothing at all. It
 * came back only when the pick happened to change the editor's selection,
 * which a pick on the module already open does not.
 */
beforeAll(() => {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: 1600,
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

function shell() {
  return (
    <ValThemeProvider theme="dark" setTheme={() => {}} config={undefined}>
      <ValPortalProvider>
        <TooltipProvider>
          <Shell
            data={mockShellData}
            theme="dark"
            onThemeChange={() => undefined}
            initialSelectionId={mockSelectionIds.home}
            canvasPage={mockCanvasPage}
            initialCanvasOpen
            // On this page: where Select is on from the start.
            initialCanvasView="fields"
            skipTransition
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>
  );
}

test("a pick on the page switches Content back on", () => {
  const view = render(shell());
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Close Content" }));
  });
  expect(
    screen
      .getByRole("button", { name: "Open Content" })
      .getAttribute("aria-pressed"),
  ).toBe("false");

  const field = view.container.querySelector("[data-field-id]");
  if (!(field instanceof HTMLElement)) {
    throw new Error("the demo page has no fields");
  }
  act(() => {
    fireEvent.click(field);
  });

  expect(
    screen
      .getByRole("button", { name: "Close Content" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
});
