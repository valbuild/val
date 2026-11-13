/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import { SourcePath } from "@valbuild/core";
import {
  BRIDGE_CAPABILITIES,
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { CanvasFrame, type CanvasFrameProps } from "./CanvasFrame";

/**
 * Editing on the page, between the Studio and the frame: what is asked of
 * the page, when it is not asked at all, and what an edit that ends without
 * the page saying so looks like from here.
 */
describe("editing a field on the page", () => {
  let posted: ValCanvasStudioMessage[];
  let frame: HTMLIFrameElement;

  const TITLE = '/content/page.val.ts?p="title"' as SourcePath;
  const request = {
    requestId: "inline-1",
    candidates: [{ path: TITLE, kind: "string" as const, value: "Our people" }],
  };

  const handlers = () => ({
    onInlineEditStarted: jest.fn(),
    onInlineEdit: jest.fn(),
    onInlineEditEnded: jest.fn(),
    onInlineEditUnavailable: jest.fn(),
  });
  const element = (props: Partial<CanvasFrameProps>) => (
    <CanvasFrame
      url="/"
      width={800}
      height={600}
      reloadKey={0}
      isPicking
      highlightedPath={null}
      {...props}
    />
  );
  const renderFrame = (props: Partial<CanvasFrameProps>) => {
    const rendered = render(element(props));
    const found = rendered.container.querySelector("iframe");
    if (found === null) throw new Error("the frame did not render");
    frame = found;
    const target = frame.contentWindow;
    if (target === null) throw new Error("the frame has no content window");
    posted = [];
    jest
      .spyOn(target, "postMessage")
      .mockImplementation((message: unknown) =>
        posted.push(message as ValCanvasStudioMessage),
      );
    return {
      ...rendered,
      set: (next: Partial<CanvasFrameProps>) =>
        rendered.rerender(element({ ...props, ...next })),
    };
  };
  /** The page saying something. */
  const say = (message: ValCanvasPageMessage) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          data: message,
        }),
      );
    });
  const ready = (capabilities?: readonly string[]) =>
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "ready",
      draftMode: true,
      url: "http://localhost/",
      ...(capabilities !== undefined ? { capabilities } : {}),
    });
  const of = (type: ValCanvasStudioMessage["type"]) =>
    posted.filter((message) => message.type === type);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("asks the page to edit what was offered, once per request", () => {
    const on = handlers();
    const rendered = renderFrame(on);
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    // The same request again, as a new object: a re-render, not a new ask.
    rendered.set({
      inlineEdit: { ...request, candidates: [...request.candidates] },
    });
    expect(of("editInline")).toEqual([
      { val: VAL_CANVAS_MESSAGE, type: "editInline", ...request },
    ]);
    expect(on.onInlineEditUnavailable).not.toHaveBeenCalled();
  });

  it("does not ask a page whose bridge predates it, and says so at once", () => {
    const on = handlers();
    const rendered = renderFrame(on);
    // An older `@valbuild/next`: no list at all, or one without it.
    ready();
    rendered.set({ inlineEdit: request });
    expect(of("editInline")).toEqual([]);
    expect(on.onInlineEditUnavailable).toHaveBeenCalledWith("inline-1");
    ready(["readPage"]);
    rendered.set({ inlineEdit: { ...request, requestId: "inline-2" } });
    expect(of("editInline")).toEqual([]);
    expect(on.onInlineEditUnavailable).toHaveBeenLastCalledWith("inline-2");
  });

  it("hands on what the page says of the edit", () => {
    const on = handlers();
    const rendered = renderFrame(on);
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditStarted",
      requestId: "inline-1",
      path: TITLE,
    });
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEdit",
      path: TITLE,
      value: "Our team",
    });
    say({ val: VAL_CANVAS_MESSAGE, type: "inlineEditEnded", path: TITLE });
    expect(on.onInlineEditStarted).toHaveBeenCalledWith("inline-1", TITLE);
    expect(on.onInlineEdit).toHaveBeenCalledWith(TITLE, "Our team");
    expect(on.onInlineEditEnded).toHaveBeenCalledWith(TITLE);
  });

  it("hands on that the page cannot", () => {
    const on = handlers();
    const rendered = renderFrame(on);
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditUnavailable",
      requestId: "inline-1",
    });
    expect(on.onInlineEditUnavailable).toHaveBeenCalledWith("inline-1");
  });

  it("tells the page to stop when the request is withdrawn mid-edit", () => {
    const rendered = renderFrame(handlers());
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditStarted",
      requestId: "inline-1",
      path: TITLE,
    });
    rendered.set({ inlineEdit: null });
    expect(of("stopInlineEdit")).toHaveLength(1);
  });

  it("...and says nothing when the page ended it itself", () => {
    const rendered = renderFrame(handlers());
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditStarted",
      requestId: "inline-1",
      path: TITLE,
    });
    say({ val: VAL_CANVAS_MESSAGE, type: "inlineEditEnded", path: TITLE });
    rendered.set({ inlineEdit: null });
    expect(of("stopInlineEdit")).toEqual([]);
  });

  it("leaving Select takes the caret off the page too", () => {
    const rendered = renderFrame(handlers());
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditStarted",
      requestId: "inline-1",
      path: TITLE,
    });
    rendered.set({ inlineEdit: request, isPicking: false });
    expect(of("stopInlineEdit")).toHaveLength(1);
  });

  it("an edit ends with its document, when the frame loads another", () => {
    const on = handlers();
    const rendered = renderFrame(on);
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditStarted",
      requestId: "inline-1",
      path: TITLE,
    });
    // The page reloaded itself: the document the caret was in is gone, and
    // could not say so.
    ready(BRIDGE_CAPABILITIES);
    expect(on.onInlineEditEnded).toHaveBeenCalledWith(TITLE);
  });
});
