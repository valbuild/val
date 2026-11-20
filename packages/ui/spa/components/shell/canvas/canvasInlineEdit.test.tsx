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

  const started = () =>
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditStarted",
      requestId: "inline-1",
      path: TITLE,
    });
  const selection = {
    anchor: { block: 0, offset: 2 },
    head: { block: 0, offset: 5 },
  };

  it("hands on what is selected in the text, once it is being edited", () => {
    const onInlineEditSelection = jest.fn();
    const rendered = renderFrame({ ...handlers(), onInlineEditSelection });
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    const report: ValCanvasPageMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditSelection",
      path: TITLE,
      selection,
      rect: { top: 10, left: 20, width: 300, height: 40 },
    };
    // Before the page said it started: a selection of nothing known.
    say(report);
    expect(onInlineEditSelection).not.toHaveBeenCalled();
    started();
    say(report);
    expect(onInlineEditSelection).toHaveBeenCalledWith(TITLE, selection);
  });

  it("sends the page what a control made of the text, once per press", () => {
    const rendered = renderFrame(handlers());
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    started();
    const value = [{ tag: "p", children: ["Our team"] }];
    const apply = { id: 1, path: TITLE, value, selection };
    rendered.set({ inlineEdit: request, inlineEditApply: apply });
    rendered.set({ inlineEdit: request, inlineEditApply: { ...apply } });
    expect(of("applyInlineEdit")).toEqual([
      {
        val: VAL_CANVAS_MESSAGE,
        type: "applyInlineEdit",
        path: TITLE,
        value,
        selection,
      },
    ]);
    rendered.set({ inlineEdit: request, inlineEditApply: { ...apply, id: 2 } });
    expect(of("applyInlineEdit")).toHaveLength(2);
  });

  it("a press elsewhere in the Studio ends the edit; one on the controls does not", () => {
    const rendered = renderFrame(handlers());
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    const controls = document.createElement("div");
    controls.setAttribute("data-val-inline-toolbar", "");
    const button = controls.appendChild(document.createElement("button"));
    const elsewhere = document.createElement("button");
    document.body.append(controls, elsewhere);
    const press = (target: Element) =>
      act(() => {
        target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
    // Nothing is being edited yet: a press is only a press.
    press(elsewhere);
    expect(of("stopInlineEdit")).toEqual([]);
    started();
    press(button);
    expect(of("stopInlineEdit")).toEqual([]);
    press(elsewhere);
    expect(of("stopInlineEdit")).toHaveLength(1);
    controls.remove();
    elsewhere.remove();
  });

  it("hands over the way to find the text and to get back to it, and takes it away", () => {
    const onInlineEditPlace = jest.fn();
    const rendered = renderFrame({ ...handlers(), onInlineEditPlace });
    const place = onInlineEditPlace.mock.calls[0][0];
    // Nothing is being edited: there is nowhere to point at.
    expect(place.locate()).toBeNull();
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    started();
    say({
      val: VAL_CANVAS_MESSAGE,
      type: "inlineEditSelection",
      path: TITLE,
      selection,
      rect: { top: 10, left: 20, width: 300, height: 40 },
    });
    expect(place.locate()).toMatchObject({ field: expect.any(Object) });
    say({ val: VAL_CANVAS_MESSAGE, type: "inlineEditEnded", path: TITLE });
    expect(place.locate()).toBeNull();
    rendered.unmount();
    expect(onInlineEditPlace).toHaveBeenLastCalledWith(null);
  });
});
