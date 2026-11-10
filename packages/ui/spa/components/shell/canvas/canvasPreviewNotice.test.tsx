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
  PREVIEW_RECOVERY,
  previewRecoveryPhase,
  shouldAutoEnable,
} from "./CanvasPreviewNotice";
import { ANSWER_TIMEOUT_MS, CanvasFrame } from "./CanvasFrame";

const { quietMs, retryEveryMs, retryForMs } = PREVIEW_RECOVERY;

/**
 * What the canvas says, and does, when it cannot do its job.
 *
 * It used to be a panel over the frame with a blurred backdrop: the published
 * page underneath - which is real, and worth reading and scrolling - was
 * unreachable behind an explanation of why it could not be EDITED. Then it was
 * a pill that offered "Turn on preview mode" as soon as the page said it was
 * off, which made the commonest state of a first visit a button to press.
 *
 * Now the Studio presses it: every five seconds for thirty, while the page
 * says preview mode is off or does not answer. For the first ten seconds a
 * spinner is all there is; then the pill says what is being done; only after
 * thirty is the person asked, with the button and the explanation.
 */
describe("the canvas preview notice", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const notice = (
    status: CanvasPreviewStatus,
    onEnable: () => void = () => undefined,
    attempt?: number,
  ) => (
    <CanvasPreviewNotice
      status={status}
      attempt={attempt}
      onEnable={onEnable}
      onReload={() => undefined}
    />
  );
  /**
   * A second at a time, as a browser would render them: one `act` over thirty
   * seconds lets React fold every tick of the clock into one render.
   */
  const wait = (ms: number) => {
    for (let left = ms; left > 0; left -= 1_000) {
      act(() => {
        jest.advanceTimersByTime(Math.min(1_000, left));
      });
    }
  };

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

  test("for the first ten seconds, a spinner and nothing else", () => {
    render(notice("connecting"));
    // Read out, not drawn: a spinner announces nothing on its own.
    const said = screen.getByText("Loading the preview…");
    expect(said.className).toContain("sr-only");
    expect(screen.queryByRole("button", { name: /Details/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Turn on preview mode/ }),
    ).toBeNull();
  });

  test("then it says what it is doing, and not what is wrong", () => {
    render(notice("preview-off"));
    wait(quietMs);
    const said = screen.getByText("Turning on preview mode…");
    expect(said.className).not.toContain("sr-only");
    expect(screen.queryByText("Preview mode is off")).toBeNull();
    expect(screen.queryByRole("button", { name: /Details/ })).not.toBeNull();
  });

  test("it turns preview mode on by itself, every five seconds for thirty", () => {
    const onEnable = jest.fn();
    render(notice("preview-off", onEnable));
    expect(onEnable).toHaveBeenCalledTimes(1);
    wait(retryEveryMs);
    expect(onEnable).toHaveBeenCalledTimes(2);
    wait(retryForMs);
    expect(onEnable).toHaveBeenCalledTimes(retryForMs / retryEveryMs);
  });

  test("and only then asks, with the button and what is wrong", () => {
    render(notice("preview-off"));
    expect(
      screen.queryByRole("button", { name: /Turn on preview mode/ }),
    ).toBeNull();
    wait(retryForMs);
    expect(screen.queryByText("Preview mode is off")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Turn on preview mode/ }),
    ).not.toBeNull();
  });

  test("a page that never answered is turned on too, and named once it gives up", () => {
    const onEnable = jest.fn();
    render(notice("no-answer", onEnable));
    expect(onEnable).toHaveBeenCalledTimes(1);
    wait(retryForMs);
    expect(screen.queryByText("No answer from the page")).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /Turn on preview mode/ }),
    ).not.toBeNull();
  });

  /**
   * Navigating the frame while a document is on its way would cut short the
   * load that was about to answer: a first `next dev` compile, or the enable
   * redirect itself.
   */
  test("it does not navigate a page that is still loading", () => {
    const onEnable = jest.fn();
    render(notice("connecting", onEnable));
    wait(retryForMs);
    expect(onEnable).not.toHaveBeenCalled();
    render(notice("enabling", onEnable));
    wait(retryForMs);
    expect(onEnable).not.toHaveBeenCalled();
  });

  /**
   * Each attempt goes `preview-off` → `enabling` → `preview-off`. If that
   * restarted the clock, the retries would never run out and the message
   * would never arrive.
   */
  test("its own attempts do not restart the clock", () => {
    const onEnable = jest.fn();
    const { rerender } = render(notice("preview-off", onEnable));
    for (let at = 0; at < retryForMs; at += retryEveryMs) {
      rerender(notice("enabling", onEnable));
      wait(1_000);
      rerender(notice("preview-off", onEnable));
      wait(retryEveryMs - 1_000);
    }
    expect(screen.queryByText("Preview mode is off")).not.toBeNull();
  });

  test("pressing the button starts it all again", () => {
    const onEnable = jest.fn();
    render(notice("preview-off", onEnable));
    wait(retryForMs);
    const calls = onEnable.mock.calls.length;
    fireEvent.click(
      screen.getByRole("button", { name: /Turn on preview mode/ }),
    );
    expect(onEnable.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.getByText("Turning on preview mode…").className).toContain(
      "sr-only",
    );
  });

  /**
   * A reload is a new attempt even when the STATUS cannot say so: reloading a
   * page that has already given up leaves it at `no-answer`.
   */
  test("a reload starts it all again, whatever the status does", () => {
    const onEnable = jest.fn();
    const { rerender } = render(notice("no-answer", onEnable, 1));
    wait(retryForMs);
    expect(screen.queryByText("No answer from the page")).not.toBeNull();
    const calls = onEnable.mock.calls.length;
    rerender(notice("no-answer", onEnable, 2));
    expect(screen.queryByText("No answer from the page")).toBeNull();
    expect(onEnable.mock.calls.length).toBeGreaterThan(calls);
  });

  /**
   * The site may send the canvas to its own sign-in page, and the editor signs
   * in there. Turning preview mode on navigates the frame, which would throw
   * away what they are typing.
   */
  test("it leaves a page alone while someone is using it", () => {
    const onEnable = jest.fn();
    render(
      <div>
        <iframe title="the page" tabIndex={0} />
        {notice("no-answer", onEnable)}
      </div>,
    );
    act(() => {
      screen.getByTitle("the page").focus();
    });
    onEnable.mockClear();
    wait(retryEveryMs * 2);
    expect(onEnable).not.toHaveBeenCalled();
  });

  test("the explanation and the reload are behind Details", () => {
    render(notice("connecting"));
    wait(quietMs);
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
   * The pill keeps quiet about the diagnosis while it is still fixing it. The
   * panel was opened on purpose, and says what the page reported.
   */
  test("but the explanation says what is known, and what is being done", () => {
    render(notice("preview-off"));
    wait(quietMs);
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(screen.queryByText(/Without preview mode/)).not.toBeNull();
    expect(screen.queryByText(/again every few seconds/)).not.toBeNull();
  });

  test("the developer's checklist is reachable from every state", () => {
    for (const status of [
      "connecting",
      "enabling",
      "no-answer",
      "preview-off",
    ] as const) {
      const { unmount } = render(notice(status));
      wait(quietMs);
      fireEvent.click(screen.getByRole("button", { name: /Details/ }));
      expect(screen.queryByText("Setup instructions")).not.toBeNull();
      unmount();
    }
  });
});

describe("the clock", () => {
  test("is quiet, then recovering, then gives up", () => {
    expect(previewRecoveryPhase(0, PREVIEW_RECOVERY)).toBe("loading");
    expect(previewRecoveryPhase(quietMs, PREVIEW_RECOVERY)).toBe("recovering");
    expect(previewRecoveryPhase(retryForMs, PREVIEW_RECOVERY)).toBe("gave-up");
  });

  test("retries only on a reason, on time, and not past the end", () => {
    const at = (
      status: CanvasPreviewStatus,
      elapsedMs: number,
      sinceLastEnableMs: number | null,
    ) =>
      shouldAutoEnable({
        status,
        elapsedMs,
        sinceLastEnableMs,
        timing: PREVIEW_RECOVERY,
      });
    expect(at("preview-off", 0, null)).toBe(true);
    expect(at("no-answer", 0, null)).toBe(true);
    expect(at("connecting", 0, null)).toBe(false);
    expect(at("enabling", 0, null)).toBe(false);
    expect(at("preview-off", 3_000, 3_000)).toBe(false);
    expect(at("preview-off", 5_000, 5_000)).toBe(true);
    expect(at("preview-off", retryForMs, null)).toBe(false);
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
