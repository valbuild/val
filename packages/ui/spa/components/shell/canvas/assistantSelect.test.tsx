/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  VAL_CANVAS_MESSAGE,
  type PickedElement,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { CanvasFrame } from "./CanvasFrame";
import { takePointedAt } from "./AssistantPage";

/**
 * The Assistant's Select, at the frame: what it asks the page to do, and
 * what it hears back. The page's half is `elementPicker.test.ts`.
 */
describe("the Assistant's Select on the frame", () => {
  const renderFrame = (
    props: Partial<Parameters<typeof CanvasFrame>[0]> = {},
  ) => {
    const rendered = render(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        {...props}
      />,
    );
    const frame = rendered.container.querySelector("iframe");
    if (frame === null || frame.contentWindow === null) {
      throw new Error("the frame did not render");
    }
    const posted: ValCanvasStudioMessage[] = [];
    jest
      .spyOn(frame.contentWindow, "postMessage")
      .mockImplementation((message: unknown) =>
        posted.push(message as ValCanvasStudioMessage),
      );
    const fromPage = (message: ValCanvasPageMessage) =>
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            data: message,
          }),
        );
      });
    return { rendered, posted, fromPage };
  };

  test("asks the page for fields only, in the colour it is given", () => {
    const { rendered, posted } = renderFrame();
    rendered.rerender(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        elementPicking={{
          active: true,
          modifier: "alt",
          keepPicked: false,
          fieldsOnly: true,
          color: "#a78bfa",
        }}
      />,
    );
    const pick = posted.filter((message) => message.type === "pickElements");
    expect(pick.at(-1)).toMatchObject({
      enabled: true,
      active: true,
      fieldsOnly: true,
      color: "#a78bfa",
    });
  });

  test("off is said, so a page that was picking stops", () => {
    const { rendered, posted } = renderFrame({
      elementPicking: { active: true, modifier: "alt", keepPicked: false },
    });
    rendered.rerender(
      <CanvasFrame
        url="/"
        width={800}
        height={600}
        reloadKey={0}
        isPicking={false}
        highlightedPath={null}
        elementPicking={null}
      />,
    );
    const pick = posted.filter((message) => message.type === "pickElements");
    expect(pick.at(-1)).toMatchObject({ enabled: false, active: false });
  });

  test("Esc on the page while picking fields stops Content's Select", () => {
    const onPickingStopped = jest.fn();
    const { fromPage } = renderFrame({ isPicking: true, onPickingStopped });
    fromPage({ val: VAL_CANVAS_MESSAGE, type: "pickingStopped" });
    expect(onPickingStopped).toHaveBeenCalledTimes(1);
  });
});

describe("what a message is about", () => {
  const picked: PickedElement = {
    tag: "h1",
    text: "Spring has come to Oslo",
    classes: [],
    selector: "main > h1",
    valPath: '/content/home.val.ts?p="title"',
  };

  test("what is picked now goes with the message, and with no other", () => {
    let pointedAt: PickedElement | null = picked;
    const page = {
      get pointedAt() {
        return pointedAt;
      },
      setPointedAt: (next: PickedElement | null) => {
        pointedAt = next;
      },
    };
    expect(takePointedAt(undefined, page)).toEqual(picked);
    expect(pointedAt).toBeNull();
    expect(takePointedAt(undefined, page)).toBeNull();
  });

  test("a queued message keeps what it was written with, and leaves the pick alone", () => {
    const setPointedAt = jest.fn();
    const later = { ...picked, text: "Picked later" };
    expect(
      takePointedAt({ pointedAt: picked }, { pointedAt: later, setPointedAt }),
    ).toEqual(picked);
    expect(setPointedAt).not.toHaveBeenCalled();
  });

  test("no page, nothing pointed at", () => {
    expect(takePointedAt(undefined, null)).toBeNull();
  });
});
