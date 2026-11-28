/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Shell } from "./Shell";
import { mockSelectionIds, mockShellData } from "./mockShellData";
import { mockCanvasPage } from "./canvas/mockCanvasPage";
import { TooltipProvider } from "../designSystem/tooltip";
import { ValPortalProvider } from "../ValPortalProvider";
import { ValThemeProvider } from "../ValThemeProvider";
import { StudioTour, isCovered, sheetSide } from "./StudioTour";
import { TourStep } from "./tourSteps";

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
 * The guided tour on a phone.
 *
 * Every one of these was broken there at once, and none of it showed on a
 * laptop: the screen behind a card with nothing to point at was not dimmed,
 * a panel step outlined the menu button its own panel was covering, the
 * assistant's step was drawn over the Data panel the step before had left
 * open, and the steps after it were explained over the conversation.
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

function phoneShell() {
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
            initialTourOpen
            skipTransition
          />
        </TooltipProvider>
      </ValPortalProvider>
    </ValThemeProvider>
  );
}

function paneShown(name: "Content" | "Preview" | "Assistant"): string | null {
  return within(screen.getByRole("navigation", { name: "Workspace panes" }))
    .getByRole("button", { name })
    .getAttribute("aria-current");
}

function stepShown(): string | null {
  return (
    document
      .querySelector("[data-val-tour-card]")
      ?.getAttribute("data-val-tour-step") ?? null
  );
}

function nextUntil(id: string) {
  for (let i = 0; i < 20 && stepShown() !== id; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  }
  expect(stepShown()).toBe(id);
}

describe("the Studio's tour on a phone", () => {
  test("the assistant's step shows the assistant, and nothing left over", () => {
    render(phoneShell());
    nextUntil("data");
    expect(screen.getByRole("dialog", { name: "Data" })).toBeTruthy();

    nextUntil("ai");
    expect(paneShown("Assistant")).toBe("page");
    // It used to stay open on top of the conversation.
    expect(screen.queryByRole("dialog", { name: "Data" })).toBeNull();
  });

  test("the steps after the assistant are back on the page", () => {
    render(phoneShell());
    nextUntil("ai");
    expect(paneShown("Assistant")).toBe("page");

    nextUntil("review");
    expect(paneShown("Content")).toBe("page");
  });

  test("and Back to the assistant's step shows it again", () => {
    render(phoneShell());
    nextUntil("review");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(stepShown()).toBe("ai");
    expect(paneShown("Assistant")).toBe("page");
  });

  test("the card is a sheet", () => {
    render(phoneShell());
    expect(
      document
        .querySelector("[data-val-tour-card]")
        ?.getAttribute("data-val-tour-sheet"),
    ).toBe("bottom");
  });
});

describe("the spotlight", () => {
  const welcome: TourStep[] = [
    { id: "welcome", title: "Welcome", body: "Hello." },
  ];

  test("with nothing to point at, dims the whole screen", () => {
    render(
      <StudioTour
        steps={welcome}
        onClose={() => undefined}
        onOpenPanel={() => undefined}
      />,
    );
    const dim = document.querySelector('[data-val-tour-dim="all"]');
    if (!(dim instanceof HTMLElement)) throw new Error("No dimming");
    // A fill, not a shadow: a shadow around a box the size of the screen is
    // entirely off it.
    expect(dim.style.background).not.toBe("");
    expect(dim.style.boxShadow).toBe("");
  });
});

/**
 * Where the target is covered, a panel step shows its panel instead: on a
 * phone the panel opens over the button that opened it.
 */
describe("a panel step whose control is covered", () => {
  type Rect = { left: number; top: number; width: number; height: number };
  const rectOf = new Map<Element, Rect>();
  const realRect = Element.prototype.getBoundingClientRect;
  let originalElementsFromPoint: Document["elementsFromPoint"] | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    Element.prototype.getBoundingClientRect = function () {
      const r = rectOf.get(this) ?? { left: 0, top: 0, width: 0, height: 0 };
      return {
        ...r,
        x: r.left,
        y: r.top,
        right: r.left + r.width,
        bottom: r.top + r.height,
        toJSON: () => r,
      };
    };
    originalElementsFromPoint = document.elementsFromPoint;
  });
  afterEach(() => {
    jest.useRealTimers();
    Element.prototype.getBoundingClientRect = realRect;
    document.elementsFromPoint =
      originalElementsFromPoint ?? (undefined as never);
    rectOf.clear();
    document.body.innerHTML = "";
  });

  test("rings the panel, not the control under it", () => {
    const button = document.createElement("button");
    button.setAttribute("data-val-tour", "pages");
    const panel = document.createElement("div");
    panel.setAttribute("data-val-tour-surface", "");
    document.body.append(button, panel);
    rectOf.set(button, { left: 8, top: 8, width: 32, height: 32 });
    rectOf.set(panel, { left: 0, top: 0, width: 340, height: 600 });
    // The panel is what is under the middle of the button.
    document.elementsFromPoint = () => [panel, button, document.body];

    const steps: TourStep[] = [
      {
        id: "pages",
        title: "Pages",
        body: "Every URL.",
        target: "pages",
        panel: "pages",
      },
    ];
    const view = render(
      <StudioTour
        steps={steps}
        onClose={() => undefined}
        onOpenPanel={() => undefined}
      />,
    );
    const tour = view.container.firstElementChild;
    if (!tour) throw new Error("No tour");
    rectOf.set(tour, { left: 0, top: 0, width: 390, height: 664 });
    act(() => jest.advanceTimersByTime(300));

    const spot = document.querySelector('[data-val-tour-dim="spotlight"]');
    if (!(spot instanceof HTMLElement)) throw new Error("No spotlight");
    expect(spot.style.width).toBe("348px");
    expect(spot.style.height).toBe("608px");
  });
});

describe("isCovered", () => {
  const box = { left: 0, top: 0, width: 10, height: 10 };
  const make = () => document.createElement("div");

  test("not when the element itself is on top", () => {
    const node = make();
    expect(isCovered({ elementsFromPoint: () => [node] }, node, box)).toBe(
      false,
    );
  });

  test("not when what is on top is inside it, or around it", () => {
    const node = make();
    const icon = make();
    node.append(icon);
    const parent = make();
    parent.append(node);
    expect(isCovered({ elementsFromPoint: () => [icon] }, node, box)).toBe(
      false,
    );
    expect(isCovered({ elementsFromPoint: () => [parent] }, node, box)).toBe(
      false,
    );
  });

  test("when something else is on top", () => {
    const node = make();
    const panel = make();
    expect(
      isCovered({ elementsFromPoint: () => [panel, node] }, node, box),
    ).toBe(true);
  });

  test("looks past the tour's own layers", () => {
    const node = make();
    const tour = make();
    tour.setAttribute("data-val-tour-layer", "");
    const sheet = make();
    tour.append(sheet);
    expect(
      isCovered({ elementsFromPoint: () => [sheet, node] }, node, box),
    ).toBe(false);
  });

  test("not when the browser cannot say", () => {
    const node = make();
    expect(isCovered({ elementsFromPoint: () => [] }, node, box)).toBe(false);
  });
});

describe("sheetSide", () => {
  const phone = { height: 664 };

  test("the bottom, when there is nothing to point at", () => {
    expect(sheetSide(null, phone, 180)).toBe("bottom");
  });

  test("the bottom, for something in the top bar", () => {
    const publish = { top: 10, left: 200, width: 80, height: 30 };
    expect(sheetSide(publish, phone, 180)).toBe("bottom");
  });

  test("the bottom, for the pane bar, which it sits above", () => {
    const tab = { top: 612, left: 120, width: 80, height: 44 };
    expect(sheetSide(tab, phone, 180)).toBe("bottom");
  });

  test("the top, for a field low on the screen", () => {
    const field = { top: 480, left: 12, width: 360, height: 60 };
    expect(sheetSide(field, phone, 180)).toBe("top");
  });

  test("the bottom, when it would cover the target either way", () => {
    const panel = { top: 0, left: 0, width: 390, height: 664 };
    expect(sheetSide(panel, phone, 180)).toBe("bottom");
  });
});
