/** @jest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import type { ValDemoAudience, ValDemoTour } from "@valbuild/shared/internal";
import { DemoBanner } from "./DemoBanner";
import { EVERYTHING, demoScriptFromSite, markDemoTourDone } from "./demoScript";

/**
 * The demo script: the card asks what brought the visitor, then lists the
 * tours for the answer, the first offered first. Nothing starts by itself.
 */
const step = (id: string) => ({ id, title: `Step ${id}`, body: "Words." });
const tours: ValDemoTour[] = [
  {
    id: "first-edit",
    title: "Make your first edit",
    duration: "30 s",
    steps: [step("a"), step("b"), step("c")],
  },
  {
    id: "add-page",
    title: "Add a page",
    duration: "1 min",
    steps: [step("a")],
  },
  { id: "schema", title: "See the schema behind a field", steps: [step("a")] },
];
const audiences: ValDemoAudience[] = [
  {
    id: "editors",
    title: "I write and edit content",
    description: "Pages, photos, languages.",
    tours: ["first-edit", "add-page"],
  },
  {
    id: "developers",
    title: "I build sites",
    tours: ["first-edit", "schema"],
  },
];

beforeEach(() => window.sessionStorage.clear());

describe("the site's script", () => {
  test("adds Show me everything, each tour once, the shared opener on top", () => {
    const script = demoScriptFromSite(tours, audiences);
    expect(script?.audiences.map((a) => a.id)).toEqual([
      "editors",
      "developers",
      EVERYTHING,
    ]);
    expect(script?.audiences[2]?.tours).toEqual([
      "first-edit",
      "add-page",
      "schema",
    ]);
  });

  test("drops what cannot be used rather than failing the card", () => {
    const script = demoScriptFromSite(
      [...tours, { id: "empty", title: "Nothing in it", steps: [] }],
      [
        {
          id: "editors",
          title: "Editors",
          tours: ["add-page", "no-such-tour"],
        },
        { id: "nobody", title: "Nobody", tours: ["no-such-tour"] },
      ],
    );
    expect(script?.tours.map((t) => t.id)).toEqual([
      "first-edit",
      "add-page",
      "schema",
    ]);
    // One answer left, so there is nothing to show "everything" of.
    expect(script?.audiences).toEqual([
      {
        id: "editors",
        title: "Editors",
        description: null,
        tours: ["add-page"],
      },
    ]);
  });

  test("is no script at all without tours", () => {
    expect(demoScriptFromSite(undefined, audiences)).toBeNull();
    expect(demoScriptFromSite([], audiences)).toBeNull();
  });
});

describe("the demo card", () => {
  const card = (onStartTour = jest.fn()) =>
    render(
      <DemoBanner
        onReset={() => undefined}
        onStartTour={onStartTour}
        script={demoScriptFromSite(tours, audiences)}
      />,
    );

  test("asks what brings the visitor first", () => {
    card();
    expect(screen.getByText("What brings you here?")).toBeTruthy();
    expect(screen.getByText("I write and edit content")).toBeTruthy();
    expect(screen.getByText("I build sites")).toBeTruthy();
    expect(screen.getByText("Show me everything")).toBeTruthy();
    expect(screen.queryByText("Add a page")).toBeNull();
  });

  test("lists the answer's tours, and starts one only when asked", () => {
    const onStartTour = jest.fn();
    card(onStartTour);
    fireEvent.click(screen.getByText("I write and edit content"));
    expect(screen.getByText("Make your first edit")).toBeTruthy();
    expect(screen.getByText("3 steps, about 30 s")).toBeTruthy();
    expect(screen.getByText("Add a page")).toBeTruthy();
    expect(screen.queryByText("See the schema behind a field")).toBeNull();
    expect(onStartTour).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Show me"));
    expect(onStartTour).toHaveBeenLastCalledWith("first-edit");
    fireEvent.click(screen.getByText("Add a page"));
    expect(onStartTour).toHaveBeenLastCalledWith("add-page");
  });

  test("remembers the answer for the tab, and Change asks again", () => {
    const first = card();
    fireEvent.click(screen.getByText("I build sites"));
    first.unmount();
    card();
    expect(screen.getByText("See the schema behind a field")).toBeTruthy();
    fireEvent.click(screen.getByText("Change"));
    expect(screen.getByText("What brings you here?")).toBeTruthy();
  });

  test("ticks off a tour that was finished", () => {
    markDemoTourDone("add-page");
    card();
    fireEvent.click(screen.getByText("I write and edit content"));
    const row = screen.getByText("Add a page").closest("button");
    expect(row?.querySelector('[aria-label="Done"]')).not.toBeNull();
  });

  test("without a script, it is the Tour button it always was", () => {
    const onStartTour = jest.fn();
    render(<DemoBanner onReset={() => undefined} onStartTour={onStartTour} />);
    expect(screen.queryByText("What brings you here?")).toBeNull();
    fireEvent.click(screen.getByText("Tour"));
    expect(onStartTour).toHaveBeenCalledWith();
  });
});
