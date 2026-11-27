/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Shell } from "./Shell";
import { mockSelectionIds, mockShellData } from "./mockShellData";
import { mockCanvasPage } from "./canvas/mockCanvasPage";
import { TooltipProvider } from "../designSystem/tooltip";
import { ValPortalProvider } from "../ValPortalProvider";
import { ValThemeProvider } from "../ValThemeProvider";
import {
  GuideRequest,
  ShowGuideArgs,
  createGuideCall,
  guideTourSteps,
} from "./assistantGuide";
import { useShellTour } from "./shellTour";
import { readTourCompleted } from "./tourSteps";

jest.mock("../../validation/schemaValidationBridge", () => ({
  createSchemaValidationBridge: () => ({
    validate: async () => ({ errors: false }),
    dispose: () => {},
  }),
}));
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: string }) => <p>{children}</p>,
}));

/**
 * The assistant's guide, in the real shell on a phone.
 *
 * What `useAI` does with a `show_guide` call is `createGuideCall` and the
 * shell's tour; this drives the same two, from a component in the
 * assistant's slot as the chat is.
 */
function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}
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
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  setWidth(390);
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

const ARGS: ShowGuideArgs = {
  title: "Open a page",
  steps: [
    {
      point_at: { control: "pages" },
      title: "Open Pages",
      text: "Every URL of your site is there.",
      done_when: { panel_open: "pages" },
    },
    {
      point_at: { page_row: "/" },
      title: "This is the home page",
      text: "Tap it to open it.",
    },
  ],
};

/** What the chat holds: the card's state, and the one answer. */
function GuideFromTheChat({
  onCard,
  onAnswer,
}: {
  onCard: (request: GuideRequest) => void;
  onAnswer: (request: GuideRequest) => void;
}) {
  const tour = useShellTour();
  const built = guideTourSteps(ARGS);
  if ("error" in built) throw new Error(built.error);
  const call = createGuideCall({
    title: ARGS.title,
    steps: built.steps,
    onChange: onCard,
    onAnswer,
  });
  return (
    <div>
      The conversation
      <button
        type="button"
        onClick={() => {
          if (tour !== null) call.start(tour);
        }}
      >
        Show me how
      </button>
      <button
        type="button"
        onClick={() => {
          if (tour !== null) call.stop(tour);
        }}
      >
        Stop
      </button>
    </div>
  );
}

function shell(
  onCard: (request: GuideRequest) => void,
  onAnswer: (request: GuideRequest) => void,
) {
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
            aiSlot={<GuideFromTheChat onCard={onCard} onAnswer={onAnswer} />}
            canvasPage={mockCanvasPage}
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

function card(): HTMLElement {
  const found = document.querySelector("[data-val-tour-card]");
  if (!(found instanceof HTMLElement)) throw new Error("No tour card");
  return found;
}

function openTheAssistant() {
  fireEvent.click(
    within(
      screen.getByRole("navigation", { name: "Workspace panes" }),
    ).getByRole("button", { name: "Assistant" }),
  );
  expect(paneShown("Assistant")).toBe("page");
}

test("starts on the page, says it is from the assistant, and does not glow", () => {
  render(shell(jest.fn(), jest.fn()));
  openTheAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Show me how" }));

  // The conversation fills a phone: the guide is about the page behind it.
  expect(paneShown("Content")).toBe("page");
  expect(within(card()).getByText("From the assistant")).toBeTruthy();
  expect(within(card()).getByText("Open Pages")).toBeTruthy();
  // The ring look: nothing dimmed, and the Studio usable underneath.
  expect(document.querySelector("[data-val-tour-dim]")).toBeNull();
});

test("moves on when the person does it, keeps their panel open, and reports how", () => {
  const onCard = jest.fn();
  const onAnswer = jest.fn();
  render(shell(onCard, onAnswer));
  openTheAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
  expect(onCard).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: { kind: "showing", step: 0 } }),
  );

  // Done by the person, the way they would: Do it for me is the same call.
  fireEvent.click(within(card()).getByRole("button", { name: "Do it for me" }));
  act(() => jest.advanceTimersByTime(1000));
  expect(within(card()).getByText("This is the home page")).toBeTruthy();
  expect(onCard).toHaveBeenLastCalledWith(
    expect.objectContaining({ state: { kind: "showing", step: 1 } }),
  );
  // The step after is about a row IN Pages: closing it would undo the step
  // before.
  expect(screen.getByRole("dialog", { name: "Pages" })).toBeTruthy();

  fireEvent.click(within(card()).getByRole("button", { name: "Done" }));
  expect(document.querySelector("[data-val-tour-card]")).toBeNull();
  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(onAnswer.mock.calls[0][0].state).toEqual({
    kind: "ended",
    outcome: { finished: true, reached: 2, steps: ["done-for-them", "read"] },
  });
});

test("Back to chat closes it, says so, and puts the conversation in front", () => {
  const onAnswer = jest.fn();
  render(shell(jest.fn(), onAnswer));
  openTheAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
  fireEvent.click(within(card()).getByRole("button", { name: "Back to chat" }));

  expect(document.querySelector("[data-val-tour-card]")).toBeNull();
  expect(paneShown("Assistant")).toBe("page");
  expect(onAnswer.mock.calls[0][0].state).toEqual({
    kind: "ended",
    outcome: { finished: false, reached: 1, steps: [], backToChat: true },
  });
});

test("the chat's Stop closes it, and it is answered once", () => {
  const onAnswer = jest.fn();
  render(shell(jest.fn(), onAnswer));
  openTheAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
  openTheAssistant();
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));

  expect(document.querySelector("[data-val-tour-card]")).toBeNull();
  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(onAnswer.mock.calls[0][0].state.outcome.finished).toBe(false);
});

test("a guide is not the Studio's tour: taking one does not mark it taken", () => {
  setWidth(1280);
  localStorage.removeItem("val:tour:completed");
  render(shell(jest.fn(), jest.fn()));
  // On a laptop the conversation is beside the page, so there is no Back to
  // chat.
  fireEvent.click(screen.getByRole("button", { name: "Show me how" }));
  expect(within(card()).queryByRole("button", { name: "Back to chat" })).toBe(
    null,
  );
  fireEvent.click(
    within(card()).getByRole("button", { name: "Close the tour" }),
  );
  expect(document.querySelector("[data-val-tour-card]")).toBeNull();
  // What the launcher's glow is read from. See `readTourCompleted`.
  expect(readTourCompleted()).toBe(false);
});
