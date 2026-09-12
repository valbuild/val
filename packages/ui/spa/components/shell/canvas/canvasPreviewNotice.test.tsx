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
    <CanvasPreviewNotice
      status={status}
      onEnable={() => undefined}
      onReload={() => undefined}
    />
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
      render(notice("preview-off"));
      expect(screen.queryByText("Preview is not ready yet")).not.toBeNull();
      expect(screen.queryByText("Preview mode is off")).toBeNull();
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS);
      });
      expect(screen.queryByText("Preview mode is off")).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
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
   * The one-click fix is one click. It used to be behind the disclosure, which
   * put the commonest act in the Studio's canvas - "turn preview mode on" -
   * two clicks away, and the E2E suites that drive the canvas found it there.
   */
  test("the fix is on the pill, once there is something to fix", () => {
    render(notice("preview-off"));
    expect(
      screen.queryByRole("button", { name: /Turn on preview mode/ }),
    ).not.toBeNull();
  });

  test("and not before: a page that has not answered yet is not accused", () => {
    render(notice("connecting"));
    expect(
      screen.queryByRole("button", { name: /Turn on preview mode/ }),
    ).toBeNull();
  });

  test("a page that never answered is offered it too", () => {
    // The same navigation fixes both, which is why the old panel offered this
    // button for both.
    render(notice("no-answer"));
    expect(
      screen.queryByRole("button", { name: /Turn on preview mode/ }),
    ).not.toBeNull();
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
      const { rerender } = render(
        <CanvasPreviewNotice
          status="no-answer"
          attempt="1:0"
          onEnable={() => undefined}
          onReload={() => undefined}
        />,
      );
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS);
      });
      expect(screen.queryByText("No answer from the page")).not.toBeNull();
      rerender(
        <CanvasPreviewNotice
          status="no-answer"
          attempt="2:0"
          onEnable={() => undefined}
          onReload={() => undefined}
        />,
      );
      expect(screen.queryByText("Preview is not ready yet")).not.toBeNull();
      act(() => {
        jest.advanceTimersByTime(PREVIEW_WARNING_DELAY_MS);
      });
      expect(screen.queryByText("No answer from the page")).not.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test("the explanation and the reload are behind Details", () => {
    render(notice("preview-off"));
    expect(screen.queryByText("Reload")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.queryByText("Reload")).not.toBeNull();
    // The explanation follows the same clock the pill does: before the wait is
    // up it says what is happening, not what is wrong.
    expect(
      screen.queryByText(/The page has not reported what is on it yet/),
    ).not.toBeNull();
  });

  test("the developer's checklist is offered only where the page is silent", () => {
    const { unmount } = render(notice("no-answer"));
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.queryByText("Setup instructions")).not.toBeNull();
    unmount();
    // A page that answered "preview mode is off" is wired up correctly: it
    // answered. Nothing to check.
    render(notice("preview-off"));
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.queryByText("Setup instructions")).toBeNull();
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
