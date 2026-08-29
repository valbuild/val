/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import { usePaneScroller } from "./usePaneScroller";

/**
 * The phone's panes, and the one thing that must always be true of them.
 *
 * The bug these are about is not a wrong pane — it is NO pane: the scroller
 * resting between the two, showing half the editor and half the canvas, with
 * nothing in the studio able to recover from it. Selecting a different page did
 * not fix it, because nothing re-asserted the position; only closing the canvas
 * did, because that removed the pane it was half way to.
 *
 * It got there because the canvas pane holds an iframe on the customer's site,
 * and a browser scrolls an ancestor scroll container for reasons of its own: to
 * reveal a frame that has just been focused by a click, and — measured, in
 * Chromium — because `scrollIntoView` inside a same-origin frame walks out of
 * the frame and scrolls the embedder's containers too. Those reveal an ELEMENT,
 * not a pane, so where they leave the scroller is arbitrary.
 *
 * So these tests do not check that any particular cause is handled. They check
 * the invariant: whenever the panes come to rest, they are on a pane.
 */
describe("the phone's pane scroller", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // jsdom has no layout, so nothing here ever resizes. The hook only uses the
    // observer to re-place the panes when the pane WIDTH changes, which these
    // tests hold fixed.
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const PANE_WIDTH = 390;

  /** Everything a test can do to the panes, and everything it can read. */
  type Panes = {
    /** Where the scroller is, as the browser would report it. */
    at(): number;
    /** Which pane the switch says. */
    pane(): string;
    /** The studio asking for a pane, as the switch and a pick both do. */
    goTo(pane: "editor" | "canvas"): void;
    /** Something other than the studio moving the scroller. */
    foreignScrollTo(left: number): void;
    /** A finger, and where it left the scroller. */
    swipeTo(left: number): void;
    /** Let everything that was going to settle, settle. */
    settle(): void;
  };

  function mount(paneCount = 2): Panes {
    let pane = "editor";
    let goTo: (next: "editor" | "canvas") => void = () => undefined;
    let scrollLeft = 0;
    let element: HTMLDivElement | null = null;

    function Harness() {
      const panes = usePaneScroller({
        enabled: true,
        paneCount,
        // The glide is not what is under test, and a jsdom `scrollTo` lands
        // instantly either way.
        animate: false,
      });
      pane = panes.pane;
      goTo = panes.goTo;
      return <div ref={panes.ref} data-testid="scroller" />;
    }

    const rendered = render(<Harness />);
    element = rendered.getByTestId("scroller") as HTMLDivElement;
    /*
     * jsdom has no layout and no scrolling, so the scroller is given both.
     *
     * Writing `scrollLeft` fires a `scroll` event, which is the one piece of
     * browser behaviour this hook is built on: it is how it learns that
     * something moved the panes, whoever that something was.
     */
    Object.defineProperty(element, "clientWidth", {
      value: PANE_WIDTH,
      configurable: true,
    });
    Object.defineProperty(element, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (next: number) => {
        scrollLeft = next;
        element?.dispatchEvent(new Event("scroll"));
      },
    });
    element.scrollTo = ((options: ScrollToOptions) => {
      if (typeof options?.left === "number") element.scrollLeft = options.left;
    }) as HTMLElement["scrollTo"];

    const settle = () => act(() => void jest.runOnlyPendingTimers());
    return {
      at: () => scrollLeft,
      pane: () => pane,
      goTo: (next) => act(() => goTo(next)),
      foreignScrollTo: (left) => act(() => void (element.scrollLeft = left)),
      swipeTo: (left) => {
        act(() => {
          element.dispatchEvent(new Event("touchstart"));
          element.scrollLeft = left;
          element.dispatchEvent(new Event("touchend"));
        });
      },
      settle,
    };
  }

  it("puts a scroller that came to rest between the panes back on one", () => {
    const panes = mount();
    panes.goTo("canvas");
    panes.settle();
    panes.goTo("editor");
    panes.settle();
    expect(panes.at()).toBe(0);

    // The shape of every cause: something revealed an element inside the canvas
    // pane, and the scroller stopped part of the way there.
    panes.foreignScrollTo(PANE_WIDTH * 0.4);
    panes.settle();

    expect(panes.at()).toBe(0);
    expect(panes.pane()).toBe("editor");
  });

  it("undoes a foreign scroll that landed exactly on the other pane", () => {
    const panes = mount();
    panes.goTo("editor");
    panes.settle();

    // The browser revealing the newly focused frame is a scroll all the way to
    // the canvas pane, and reads as a perfectly ordinary pane change. It is not
    // one: nobody asked for it.
    panes.foreignScrollTo(PANE_WIDTH);
    panes.settle();

    expect(panes.at()).toBe(0);
    expect(panes.pane()).toBe("editor");
  });

  it("keeps correcting, however long after the move", () => {
    const panes = mount();
    panes.goTo("editor");
    panes.settle();

    // The version this replaces held the position for 400ms and then let go, so
    // anything slow enough — a phone busy mounting a column of fields — won.
    act(() => void jest.advanceTimersByTime(60_000));
    panes.foreignScrollTo(PANE_WIDTH * 0.6);
    panes.settle();

    expect(panes.at()).toBe(0);
  });

  it("adopts the pane a swipe ended on", () => {
    const panes = mount();

    panes.swipeTo(PANE_WIDTH * 0.8);
    panes.settle();

    expect(panes.pane()).toBe("canvas");
    // And exactly on it: a swipe that stopped short is still a swipe to the
    // canvas, and half a pane is not a place to be left.
    expect(panes.at()).toBe(PANE_WIDTH);
  });

  it("does not adopt a foreign scroll that follows a tap", () => {
    const panes = mount();
    panes.goTo("editor");
    panes.settle();

    // A tap on the canvas pane is a `touchstart` and a `touchend` with no
    // scroll between them. What follows is the browser revealing the frame the
    // tap focused — which must not be read as the tap having chosen a pane.
    act(() => {
      const el = document.querySelector("[data-testid=scroller]");
      el?.dispatchEvent(new Event("touchstart"));
      el?.dispatchEvent(new Event("touchend"));
    });
    panes.settle();
    panes.foreignScrollTo(PANE_WIDTH);
    panes.settle();

    expect(panes.pane()).toBe("editor");
    expect(panes.at()).toBe(0);
  });

  it("has nowhere but the editor to be when the canvas is closed", () => {
    const panes = mount(1);

    panes.foreignScrollTo(PANE_WIDTH);
    panes.settle();

    expect(panes.pane()).toBe("editor");
    expect(panes.at()).toBe(0);
  });
});
