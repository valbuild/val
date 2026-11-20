/**
 * @jest-environment jsdom
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ModuleFilePath } from "@valbuild/core";
import {
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
} from "@valbuild/shared/internal";
import { CanvasFrame } from "./CanvasFrame";
import {
  CanvasCodeChangedNotice,
  codeChangedMessage,
} from "./CanvasCodeChangedNotice";
import { CodeChangedCard } from "../CodeChangedCard";

/**
 * The page in the canvas could not show the Studio's content for some
 * modules, because it was made with another schema than the page's build
 * has: the page shows its own, and the Studio says the code changed, with a
 * reload (`codeChanged` in the canvas protocol). A new document says again
 * whatever it still cannot read, so `ready` takes the old answer back.
 */
const HOME = "/content/home.val.ts" as ModuleFilePath;
const ABOUT = "/content/about.val.ts" as ModuleFilePath;

describe("the canvas hearing that the page's code is behind", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const renderFrame = (onCodeChanged: (modules: ModuleFilePath[]) => void) => {
    const rendered = render(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        onCodeChanged={onCodeChanged}
      />,
    );
    const frame = rendered.container.querySelector("iframe");
    if (frame === null) throw new Error("the frame did not render");
    const target = frame.contentWindow;
    if (target === null) throw new Error("the frame has no content window");
    jest.spyOn(target, "postMessage").mockImplementation(() => {});
    return (message: ValCanvasPageMessage) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", { source: target, data: message }),
        );
      });
  };

  test("passes on what the page could not read, and a new document starts over", () => {
    const told: ModuleFilePath[][] = [];
    const fromPage = renderFrame((modules) => told.push(modules));
    fromPage({ val: VAL_CANVAS_MESSAGE, type: "codeChanged", modules: [HOME] });
    expect(told).toEqual([[HOME]]);
    fromPage({
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode: true,
      url: "/",
    });
    expect(told).toEqual([[HOME], []]);
  });

  test("ignores the message from anything but its frame", () => {
    const told: ModuleFilePath[][] = [];
    renderFrame((modules) => told.push(modules));
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          data: {
            val: VAL_CANVAS_MESSAGE,
            type: "codeChanged",
            modules: [HOME],
          },
        }),
      );
    });
    expect(told).toEqual([]);
  });
});

describe("saying the code changed", () => {
  test("names the one file, or counts them", () => {
    expect(codeChangedMessage([HOME])).toContain("home.val.ts");
    expect(codeChangedMessage([HOME, ABOUT])).toContain("2 files");
  });

  test("the canvas's notice offers the reload, and says nothing for nothing", () => {
    const onReload = jest.fn();
    const { rerender } = render(
      <CanvasCodeChangedNotice modules={[HOME]} onReload={onReload} />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      "older code than the Studio",
    );
    fireEvent.click(screen.getByRole("button", { name: /Reload/ }));
    expect(onReload).toHaveBeenCalledTimes(1);

    rerender(<CanvasCodeChangedNotice modules={[]} onReload={onReload} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("the overlay's card says the same, with the reload", () => {
    const onReload = jest.fn();
    render(<CodeChangedCard modules={[HOME]} onReload={onReload} />);
    expect(screen.getByText("The code changed")).toBeTruthy();
    expect(screen.getByText(codeChangedMessage([HOME]))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reload/ }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
