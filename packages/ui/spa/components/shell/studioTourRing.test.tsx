/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SourcePath } from "@valbuild/core";
import { StudioTour, TourObserved, hasMovedOn } from "./StudioTour";
import { TourStep } from "./tourSteps";
import { demoTourStepsFromSite } from "../../demo/demoTour";
import { isSourcePath } from "../../utils/sourcePath";

/**
 * The demo's tour: the ring look, and steps that move on when the visitor has
 * done what they ask.
 *
 * The demo asks people to DO things in the Studio -- click the heading, change
 * a word -- so the tour cannot sit behind a sheet that catches the click, or
 * take focus from the field being typed in, and a step that has been done has
 * to notice and move on by itself.
 */
function sourcePath(value: string): SourcePath {
  if (!isSourcePath(value)) throw new Error(`not a source path: ${value}`);
  return value;
}
const HEADING = sourcePath('/src/routes/index.val.ts?p="title"');
const PAGE = sourcePath("/src/routes/index.val.ts");

const observed = (over: Partial<TourObserved> = {}): TourObserved => ({
  selectedPath: null,
  reviewCount: 0,
  openPanel: null,
  locale: null,
  ...over,
});

const steps: TourStep[] = [
  {
    id: "click",
    title: "Click the heading",
    body: "On the page.",
    target: "canvas",
    page: HEADING,
    moveOn: { type: "open", path: HEADING },
  },
  {
    id: "type",
    title: "Change a word",
    body: "Type anything.",
    moveOn: {
      type: "edit",
      write: { path: HEADING, value: "Coffee, roasted this weekend" },
    },
  },
  {
    id: "draft",
    title: "That's a draft",
    body: "In Review.",
    target: "review",
  },
];

function ringTour(props: Partial<Parameters<typeof StudioTour>[0]> = {}) {
  return (
    <StudioTour
      steps={steps}
      onClose={() => undefined}
      onOpenPanel={() => undefined}
      look="ring"
      observed={observed()}
      {...props}
    />
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("the ring look", () => {
  test("dims nothing and lets clicks through to the Studio", () => {
    const { container } = render(ringTour());
    const root = container.firstElementChild;
    expect(root?.className).toContain("pointer-events-none");
    // The spotlight's scrim is a 9999px shadow; the ring has none.
    expect(container.innerHTML).not.toContain("9999px");
  });

  test("does not take focus from where the visitor is working", () => {
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    render(ringTour());
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  test("says each step to a screen reader instead", () => {
    render(ringTour());
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("Click the heading. On the page.");
  });

  test("outlines the step's place on the page, and clears it when it closes", () => {
    const onHighlightPage = jest.fn();
    const { unmount } = render(ringTour({ onHighlightPage }));
    expect(onHighlightPage).toHaveBeenLastCalledWith(HEADING);
    unmount();
    expect(onHighlightPage).toHaveBeenLastCalledWith(null);
  });
});

describe("a step that moves on by itself", () => {
  test("has Skip and Do it for me rather than Next", () => {
    render(ringTour({ act: { openPath: () => undefined } }));
    expect(screen.queryByText("Next")).toBeNull();
    expect(screen.queryByText("Skip")).not.toBeNull();
    expect(screen.queryByText("Do it for me")).not.toBeNull();
  });

  test("offers Do it for me only where it can be done", () => {
    render(ringTour({ act: {} }));
    expect(screen.queryByText("Do it for me")).toBeNull();
  });

  test("moves on once the visitor has opened the field", () => {
    const { rerender } = render(ringTour());
    rerender(ringTour({ observed: observed({ selectedPath: HEADING }) }));
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText("Change a word")).not.toBeNull();
  });

  test("opening something INSIDE the path counts; the page around it does not", () => {
    const { rerender } = render(ringTour());
    rerender(ringTour({ observed: observed({ selectedPath: PAGE }) }));
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText("Click the heading")).not.toBeNull();
  });

  test("Do it for me does it the Studio's way, and the step then moves on", () => {
    const openPath = jest.fn();
    const { rerender } = render(ringTour({ act: { openPath } }));
    fireEvent.click(screen.getByText("Do it for me"));
    expect(openPath).toHaveBeenCalledWith(HEADING);
    rerender(
      ringTour({
        act: { openPath },
        observed: observed({ selectedPath: HEADING }),
      }),
    );
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText("Change a word")).not.toBeNull();
  });

  test("an edit counts only if it is made during the step", () => {
    const write = jest.fn();
    // Two changes already made before the tour got here.
    const before = observed({ selectedPath: HEADING, reviewCount: 2 });
    const { rerender } = render(ringTour({ observed: before, act: { write } }));
    act(() => jest.advanceTimersByTime(1000));
    // On "Change a word" now, with the count still at 2: not done yet.
    expect(screen.queryByText("Change a word")).not.toBeNull();
    fireEvent.click(screen.getByText("Do it for me"));
    expect(write).toHaveBeenCalledWith(
      HEADING,
      "Coffee, roasted this weekend",
      false,
    );
    rerender(
      ringTour({ observed: { ...before, reviewCount: 3 }, act: { write } }),
    );
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText("That's a draft")).not.toBeNull();
  });

  test("Skip moves on without doing it", () => {
    const openPath = jest.fn();
    render(ringTour({ act: { openPath } }));
    fireEvent.click(screen.getByText("Skip"));
    expect(openPath).not.toHaveBeenCalled();
    expect(screen.queryByText("Change a word")).not.toBeNull();
  });

  test("the last step, once done, closes the tour", () => {
    const onClose = jest.fn();
    render(
      <StudioTour
        steps={[steps[0]]}
        onClose={onClose}
        onOpenPanel={() => undefined}
        look="ring"
        observed={observed({ selectedPath: HEADING })}
      />,
    );
    act(() => jest.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("hasMovedOn", () => {
  test("a panel step is done when that panel is open", () => {
    expect(
      hasMovedOn(
        { type: "panel", panel: "pages" },
        observed({ openPanel: "pages" }),
        observed(),
      ),
    ).toBe(true);
  });

  test("a language step is done when the language changes during it", () => {
    const start = observed({ locale: null });
    expect(hasMovedOn({ type: "locale" }, start, start)).toBe(false);
    expect(
      hasMovedOn({ type: "locale" }, observed({ locale: "de-DE" }), start),
    ).toBe(true);
  });
});

describe("the site's tour", () => {
  test("is the Studio's steps, path by path", () => {
    expect(
      demoTourStepsFromSite([
        {
          id: "click",
          title: "Click the heading",
          body: "On the page.",
          target: "canvas",
          page: HEADING,
          moveOn: { open: HEADING },
        },
        {
          id: "type",
          title: "Change a word",
          body: "Type anything.",
          field: HEADING,
          moveOn: { edit: true, path: HEADING, value: "Hello" },
        },
        {
          id: "pages",
          title: "Pages",
          body: "Every page.",
          moveOn: { panel: "pages" },
        },
      ]),
    ).toEqual([
      {
        id: "click",
        title: "Click the heading",
        body: "On the page.",
        target: "canvas",
        page: HEADING,
        moveOn: { type: "open", path: HEADING },
      },
      {
        id: "type",
        title: "Change a word",
        body: "Type anything.",
        field: HEADING,
        moveOn: { type: "edit", write: { path: HEADING, value: "Hello" } },
      },
      {
        id: "pages",
        title: "Pages",
        body: "Every page.",
        moveOn: { type: "panel", panel: "pages" },
      },
    ]);
  });

  /*
   * The site's steps arrive at run time, possibly from plain JavaScript: what
   * cannot be used is dropped, and the visitor can always get past a step.
   */
  test("a path that is not a source path leaves a step with Next", () => {
    const [step] = demoTourStepsFromSite([
      {
        id: "click",
        title: "Click it",
        body: "Somewhere.",
        page: "the heading",
        moveOn: { open: "the heading" },
      },
    ]);
    expect(step).toEqual({
      id: "click",
      title: "Click it",
      body: "Somewhere.",
    });
  });

  test("an edit with nothing to write still waits for the visitor", () => {
    const [step] = demoTourStepsFromSite([
      { id: "type", title: "Type", body: "Anything.", moveOn: { edit: true } },
    ]);
    expect(step?.moveOn).toEqual({ type: "edit" });
  });
});

describe("the demo script's tours", () => {
  test("a tour whose last step is done says it finished, before it closes", () => {
    const calls: string[] = [];
    render(
      <StudioTour
        steps={[steps[2]]}
        onClose={() => calls.push("close")}
        onFinish={() => calls.push("finish")}
        onOpenPanel={() => undefined}
        look="ring"
        observed={observed()}
      />,
    );
    fireEvent.click(screen.getByText("Done"));
    expect(calls).toEqual(["finish", "close"]);
  });

  test("closing it part way is not finishing it", () => {
    const onFinish = jest.fn();
    render(ringTour({ onFinish }));
    fireEvent.click(screen.getByLabelText("Close the tour"));
    expect(onFinish).not.toHaveBeenCalled();
  });

  test("shows the code a step names, with its file", () => {
    render(
      <StudioTour
        steps={[
          {
            ...steps[2],
            code: {
              file: "src/routes/index.val.ts",
              text: "title: s.string().maxLength(60),",
            },
          },
        ]}
        onClose={() => undefined}
        onOpenPanel={() => undefined}
        look="ring"
        observed={observed()}
      />,
    );
    expect(screen.getByText("src/routes/index.val.ts")).toBeTruthy();
    expect(screen.getByText("title: s.string().maxLength(60),")).toBeTruthy();
  });

  test("a new page: Do it for me adds it, and a new change moves it on", () => {
    const addPage = jest.fn();
    const page = sourcePath('/src/routes/journal.val.ts?p="/journal/new"');
    const newPage: TourStep[] = [
      {
        id: "page",
        title: "Add a page",
        body: "Any address.",
        moveOn: { type: "newPage", path: page },
      },
      steps[2],
    ];
    const tour = (o: TourObserved) => (
      <StudioTour
        steps={newPage}
        onClose={() => undefined}
        onOpenPanel={() => undefined}
        look="ring"
        observed={o}
        act={{ addPage }}
      />
    );
    const { rerender } = render(tour(observed()));
    fireEvent.click(screen.getByText("Do it for me"));
    expect(addPage).toHaveBeenCalledWith(page);
    rerender(tour(observed({ reviewCount: 1 })));
    act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText("That's a draft")).not.toBeNull();
  });

  test("an edit can add, and write any value", () => {
    const write = jest.fn();
    const blocks = sourcePath('/src/routes/index.val.ts?p="sections".4');
    const block = { type: "quote", text: "Good coffee.", by: "A reader" };
    render(
      <StudioTour
        steps={[
          {
            id: "add",
            title: "Add a block",
            body: "Any block.",
            moveOn: {
              type: "edit",
              write: { path: blocks, value: block, add: true },
            },
          },
        ]}
        onClose={() => undefined}
        onOpenPanel={() => undefined}
        look="ring"
        observed={observed()}
        act={{ write }}
      />,
    );
    fireEvent.click(screen.getByText("Do it for me"));
    expect(write).toHaveBeenCalledWith(blocks, block, true);
  });
});
