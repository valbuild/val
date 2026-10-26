/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
} from "@valbuild/shared/internal";
import {
  CanvasPreviewNotice,
  CanvasPreviewStatus,
  PREVIEW_WARNING_DELAY_MS,
} from "./CanvasPreviewNotice";
import { ANSWER_TIMEOUT_MS, CanvasFrame } from "./CanvasFrame";

/**
 * What the canvas says when it cannot do its job.
 *
 * It used to be a panel over the frame with a blurred backdrop: the published
 * page underneath - which is real, and worth reading and scrolling - was
 * unreachable behind an explanation of why it could not be EDITED. And because
 * the panel appeared during ordinary slowness (a first `next dev` compile of a
 * route), the normal path to a working canvas went through a screen that looked
 * like a failure.
 *
 * Three things are pinned here: the notice is not a blocker, it looks like
 * loading before it looks like a problem, and the long explanation is behind a
 * disclosure rather than on screen.
 */
describe("the canvas preview notice", () => {
  const notice = (status: CanvasPreviewStatus) => (
    <CanvasPreviewNotice status={status} onReload={() => undefined} />
  );

  test("says nothing at all once the canvas works", () => {
    const { container } = render(notice("live"));
    expect(container.textContent).toBe("");
  });

  test("does not take the pointer away from the page", () => {
    // The layer is full width so the pill can be centred; only the pill itself
    // may be clickable, or this is the old blocking panel with nothing drawn
    // on it.
    const { container } = render(notice("preview-off"));
    const layer = container.firstElementChild;
    expect(layer?.className).toContain("pointer-events-none");
    expect(layer?.firstElementChild?.className).toContain(
      "pointer-events-auto",
    );
  });

  test("reads as loading before it reads as a problem", () => {
    jest.useFakeTimers();
    try {
      // A page that has answered "draft mode is off" is a definite answer, and
      // it is STILL not accused for the first stretch: turning preview on is a
      // redirect and a fresh document, and compiling a route can take seconds.
      render(notice("connecting"));
      expect(screen.queryByText("Preview is not ready yet")).not.toBeNull();
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS);
      });
      expect(screen.queryByText("No answer from the page")).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * What the page answered, said at once.
   *
   * The pill has no button: the pick button under it is what turns preview
   * mode on, so the pill's job is to say why that is needed - and a page
   * that has ANSWERED that preview mode is off is not a guess about a page
   * that might still be compiling. The clock still decides the colours.
   */
  test("a page that answered is described as it answered, without waiting", () => {
    jest.useFakeTimers();
    try {
      const { container } = render(notice("preview-off"));
      const said = screen.getByText("Preview mode is off");
      expect(said.closest(".sr-only")).toBeNull();
      // Not a warning yet: an ordinary first load passes through this.
      expect(container.querySelector(".bg-bg-warning-primary")).toBeNull();
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS);
      });
      expect(container.querySelector(".bg-bg-warning-primary")).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * The enabling state said the same thing twice, with two spinners: the pill's
   * own label reads "Turning on preview mode…", and a chip beside it read
   * "Turning on…".
   */
  test("turning on is said once", () => {
    render(notice("enabling"));
    expect(screen.queryByText("Turning on preview mode…")).not.toBeNull();
    expect(screen.queryByText("Turning on…")).toBeNull();
  });

  test("a silent page is named as one, once the wait is up", () => {
    jest.useFakeTimers();
    try {
      render(notice("no-answer"));
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS);
      });
      expect(screen.queryByText("No answer from the page")).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test("the wait survives the diagnosis changing", () => {
    jest.useFakeTimers();
    try {
      // `connecting` becoming `preview-off` is the same attempt ten
      // milliseconds later, not a new one. Restarting the clock there is how
      // the warning would never arrive on a page that answers immediately.
      const { rerender } = render(notice("connecting"));
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS / 2);
      });
      rerender(notice("preview-off"));
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS / 2);
      });
      expect(screen.queryByText("Preview mode is off")).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * No button of its own, in any state.
   *
   * It used to carry "Turn on preview mode". With the pick button outlined
   * right under the pill, that was two buttons for one act, and the one on
   * the pill left you to find the other afterwards to select anything.
   */
  test("turning preview on is the pick button's, not the pill's", () => {
    for (const status of [
      "connecting",
      "enabling",
      "no-answer",
      "preview-off",
    ] as const) {
      const { unmount } = render(notice(status));
      expect(
        screen.queryByRole("button", { name: /Turn on preview mode/ }),
      ).toBeNull();
      unmount();
    }
  });

  test("and the explanation says where it is", () => {
    for (const status of ["no-answer", "preview-off"] as const) {
      const { unmount } = render(notice(status));
      fireEvent.click(screen.getByRole("button", { name: /Details/ }));
      expect(screen.queryByText(/Press the select button/)).not.toBeNull();
      unmount();
    }
  });

  /**
   * A reload is a new attempt even when the STATUS cannot say so: reloading a
   * page that has already given up leaves it at `no-answer`, and without an
   * attempt identity the clock went on timing the attempt before it - so the
   * warning was already showing a second into the new one.
   */
  test("a fresh attempt restarts the wait, whatever the status does", () => {
    jest.useFakeTimers();
    try {
      // The label is the page's answer either way, so the clock shows in the
      // colours: a warning is what the wait being up looks like.
      const isWarning = () =>
        document.querySelector(".bg-bg-warning-primary") !== null;
      const { rerender } = render(
        <CanvasPreviewNotice
          status="no-answer"
          attempt="1:0"
          onReload={() => undefined}
        />,
      );
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS);
      });
      expect(isWarning()).toBe(true);
      rerender(
        <CanvasPreviewNotice
          status="no-answer"
          attempt="2:0"
          onReload={() => undefined}
        />,
      );
      expect(isWarning()).toBe(false);
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS);
      });
      expect(isWarning()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("the explanation and the reload are behind Details", () => {
    render(notice("connecting"));
    expect(screen.queryByText("Reload")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.queryByText("Reload")).not.toBeNull();
    // A page that has not answered is described as that, not accused of
    // anything: this is the state a first `next dev` compile passes through.
    expect(
      screen.queryByText(/The page has not reported what is on it yet/),
    ).not.toBeNull();
  });

  /**
   * The panel does not keep the pill's silence.
   *
   * The pill withholds a diagnosis for the first stretch because it appears
   * without being asked for. The panel was opened on purpose, and answering
   * "the page has not reported what is on it yet" to a page that has reported
   * — and reported that preview mode is off — is the one place being unhelpful
   * on purpose.
   */
  test("but the explanation says what is known, without waiting", () => {
    render(notice("preview-off"));
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.queryByText(/Without preview mode/)).not.toBeNull();
    expect(
      screen.queryByText(/The page has not reported what is on it yet/),
    ).toBeNull();
  });

  /**
   * The checklist used to be offered only where the page never answered, on the
   * grounds that a page which answered is wired up correctly. That withheld it
   * from the person most likely to want it: someone whose preview mode will not
   * stay on presses the button, lands back on `preview-off`, and was then in
   * the one state with no route to the setup help.
   */
  test("the developer's checklist is reachable from every state", () => {
    for (const status of [
      "connecting",
      "enabling",
      "no-answer",
      "preview-off",
    ] as const) {
      const { unmount } = render(notice(status));
      fireEvent.click(screen.getByRole("button", { name: /Details/ }));
      expect(screen.queryByText("Setup instructions")).not.toBeNull();
      unmount();
    }
  });
});

/**
 * The frame's half of it: it reports, and it draws nothing over the page.
 */
describe("what the frame reports", () => {
  const renderFrame = (onStatusChange: (s: CanvasPreviewStatus) => void) => {
    const rendered = render(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        onStatusChange={onStatusChange}
      />,
    );
    const frame = rendered.container.querySelector("iframe");
    if (frame === null) throw new Error("the frame did not render");
    return { rendered, frame };
  };

  /** The page announcing itself. */
  const ready = (frame: HTMLIFrameElement, draftMode: boolean) => {
    const message: ValCanvasPageMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode,
      url: "/",
    };
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: message,
        }),
      );
    });
  };

  test("waiting, then what the page said", () => {
    const seen: CanvasPreviewStatus[] = [];
    const { frame } = renderFrame((status) => seen.push(status));
    expect(seen[0]).toBe("connecting");
    ready(frame, false);
    expect(seen.at(-1)).toBe("preview-off");
    ready(frame, true);
    expect(seen.at(-1)).toBe("live");
  });

  /**
   * The canvas must not turn preview mode on by itself.
   *
   * `enableKey` is watched by an effect that also depends on `enablePreview`,
   * which is rebuilt whenever the canvas changes route - so a "skip the first
   * run" flag let every later run through, and typing a different route
   * navigated the frame through `/api/val/enable`. That is a cookie being set
   * on somebody's site because they looked at a second page, and no test above
   * this level can see it: the canvas comes out working, just more enabled than
   * anyone asked for.
   */
  test("does not enable preview mode on its own when the route changes", () => {
    const { rendered, frame } = renderFrame(() => undefined);
    const src = frame.getAttribute("src");
    rendered.rerender(
      <CanvasFrame
        url="/blogs/blog1"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        enableKey={0}
      />,
    );
    const after = rendered.container.querySelector("iframe");
    expect(after?.getAttribute("src")).not.toContain("/api/val/enable");
    // And it is the new page, not the old one: the frame still follows `url`.
    expect(after?.getAttribute("src")).not.toBe(src);
  });

  test("and does when the key moves", () => {
    const { rendered, frame } = renderFrame(() => undefined);
    rendered.rerender(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        enableKey={1}
      />,
    );
    // Assigning `src` is the navigation - the frame is not remounted for it,
    // so this is the same element with a new location.
    expect(frame.getAttribute("src")).toContain("/api/val/enable");
  });

  /**
   * An enable that never lands must not say "Turning on…" forever. `isEnabling`
   * is only cleared by the page announcing itself, so a redirect that 404s or a
   * page that does not come back would sit in that state for the life of the
   * tab - with no diagnosis and none of the actions that go with one.
   */
  test("an enable that never answers gives up like any other attempt", () => {
    jest.useFakeTimers();
    try {
      const seen: CanvasPreviewStatus[] = [];
      const { rendered } = renderFrame((status) => seen.push(status));
      rendered.rerender(
        <CanvasFrame
          url="/"
          width={800}
          height={600}
          reloadKey={0}
          isPicking={false}
          highlightedPath={null}
          enableKey={1}
          onStatusChange={(status) => seen.push(status)}
        />,
      );
      expect(seen.at(-1)).toBe("enabling");
      act(() => {
        jest.advanceTimersByTime(ANSWER_TIMEOUT_MS);
      });
      expect(seen.at(-1)).toBe("no-answer");
    } finally {
      jest.useRealTimers();
    }
  });

  test("nothing is rendered over the page", () => {
    // The frame is the whole of the canvas now: one iframe, no overlay. The
    // notice lives above the viewport, outside the zoom transform.
    const { rendered } = renderFrame(() => undefined);
    expect(rendered.container.textContent).toBe("");
  });
});
