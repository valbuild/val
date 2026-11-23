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
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasWindow } from "./CanvasWindow";

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

  it("sends the page the marks for what is typed next, once per press", () => {
    const rendered = renderFrame(handlers());
    ready(BRIDGE_CAPABILITIES);
    rendered.set({ inlineEdit: request });
    // Nothing is being edited yet: nothing to type with them.
    const marks = { id: 1, path: TITLE, styles: ["bold"], selection };
    rendered.set({ inlineEdit: request, inlineEditMarks: marks });
    expect(of("markInlineEdit")).toEqual([]);
    started();
    rendered.set({ inlineEdit: request, inlineEditMarks: { ...marks, id: 2 } });
    rendered.set({ inlineEdit: request, inlineEditMarks: { ...marks, id: 2 } });
    expect(of("markInlineEdit")).toEqual([
      {
        val: VAL_CANVAS_MESSAGE,
        type: "markInlineEdit",
        path: TITLE,
        styles: ["bold"],
        selection,
      },
    ]);
    rendered.set({
      inlineEdit: request,
      inlineEditMarks: { id: 3, path: TITLE, styles: [], selection: null },
    });
    expect(of("markInlineEdit").at(-1)).toMatchObject({ styles: [] });
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

  describe("the preview's own controls", () => {
    /** The preview's toolbar, as the Studio renders it beside the frame. */
    const renderToolbar = () =>
      render(
        <CanvasToolbar
          device="desktop"
          onDeviceChange={() => undefined}
          scale={1}
          onZoomIn={() => undefined}
          onZoomOut={() => undefined}
          onFit={() => undefined}
          onReload={() => undefined}
        />,
      );
    const press = (target: Element) =>
      act(() => {
        target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
    const release = (target: Element) =>
      act(() => {
        target.dispatchEvent(new Event("pointerup", { bubbles: true }));
      });
    const afterwards = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

    it("zoom, fit and a width keep the edit, and put the caret back once the press is over", async () => {
      const rendered = renderFrame(handlers());
      // jsdom has no focus between documents to give.
      const focusFrame = jest
        .spyOn(frame.contentWindow!, "focus")
        .mockImplementation(() => undefined);
      ready(BRIDGE_CAPABILITIES);
      rendered.set({ inlineEdit: request });
      started();
      const toolbar = renderToolbar();
      for (const label of [
        "Zoom in",
        "Zoom out",
        "Fit page width",
        "mobile width",
      ]) {
        posted.length = 0;
        const button = toolbar.getByRole("button", { name: label });
        press(button);
        expect(of("stopInlineEdit")).toEqual([]);
        // Not while the button is held: what it does comes on release.
        expect(of("focusInlineEdit")).toEqual([]);
        release(button);
        await afterwards();
        expect(of("stopInlineEdit")).toEqual([]);
        expect(of("focusInlineEdit")).toHaveLength(1);
      }
      expect(focusFrame).toHaveBeenCalledTimes(4);
    });

    it("so does the window the page is scrolled in", async () => {
      // jsdom has no layout, and the window measures the page.
      const original = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      const rendered = renderFrame(handlers());
      ready(BRIDGE_CAPABILITIES);
      rendered.set({ inlineEdit: request });
      started();
      const window = render(
        <CanvasWindow pageWidth={800} scale={1} onScaleChange={() => undefined}>
          <div data-testid="page" />
        </CanvasWindow>,
      );
      press(window.getByTestId("page"));
      expect(of("stopInlineEdit")).toEqual([]);
      window.unmount();
      globalThis.ResizeObserver = original;
    });

    it("the reload ends it: it replaces the document the caret is in", () => {
      const rendered = renderFrame(handlers());
      ready(BRIDGE_CAPABILITIES);
      rendered.set({ inlineEdit: request });
      started();
      const toolbar = renderToolbar();
      press(toolbar.getByRole("button", { name: "Reload the page" }));
      expect(of("stopInlineEdit")).toHaveLength(1);
    });

    it("a press that is never released does not take the focus from what is pressed next", async () => {
      const rendered = renderFrame(handlers());
      ready(BRIDGE_CAPABILITIES);
      rendered.set({ inlineEdit: request });
      started();
      const toolbar = renderToolbar();
      const elsewhere = document.body.appendChild(
        document.createElement("input"),
      );
      // A scrollbar dragged and let go of without a word.
      press(toolbar.getByRole("button", { name: "Zoom in" }));
      press(elsewhere);
      expect(of("stopInlineEdit")).toHaveLength(1);
      say({ val: VAL_CANVAS_MESSAGE, type: "inlineEditEnded", path: TITLE });
      release(elsewhere);
      await afterwards();
      expect(of("focusInlineEdit")).toEqual([]);
      elsewhere.remove();
    });
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

  describe("the page's texts, said ahead of a click", () => {
    const fields = {
      editing: true,
      editable: [{ path: TITLE, kind: "string" as const, value: "Our people" }],
      empty: [],
    };

    it("are sent once the page is ready, and again only when they change", () => {
      const rendered = renderFrame({ ...handlers(), textFields: fields });
      expect(of("textFields")).toEqual([]);
      ready(BRIDGE_CAPABILITIES);
      expect(of("textFields")).toEqual([
        { val: VAL_CANVAS_MESSAGE, type: "textFields", ...fields },
      ]);
      // A re-render with the same texts: nothing new to say.
      rendered.set({
        textFields: { ...fields, editable: [...fields.editable] },
      });
      expect(of("textFields")).toHaveLength(1);
      // An edit changed what the title holds.
      const edited = {
        ...fields,
        editable: [{ ...fields.editable[0], value: "Our team" }],
      };
      rendered.set({ textFields: edited });
      expect(of("textFields").at(-1)).toEqual({
        val: VAL_CANVAS_MESSAGE,
        type: "textFields",
        ...edited,
      });
      // A new document is told again.
      ready(BRIDGE_CAPABILITIES);
      expect(of("textFields")).toHaveLength(3);
    });

    it("say nothing is a text while Select is off", () => {
      const rendered = renderFrame({ ...handlers(), textFields: fields });
      ready(BRIDGE_CAPABILITIES);
      rendered.set({ textFields: fields, isPicking: false });
      expect(of("textFields").at(-1)).toEqual({
        val: VAL_CANVAS_MESSAGE,
        type: "textFields",
        editing: false,
        editable: [],
        empty: [],
      });
    });

    it("an edit the page started on a click is handed on, and stopped when the Studio will not have it", () => {
      const on = handlers();
      on.onInlineEditStarted
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      renderFrame({ ...on, textFields: fields });
      ready(BRIDGE_CAPABILITIES);
      const started: ValCanvasPageMessage = {
        val: VAL_CANVAS_MESSAGE,
        type: "inlineEditStarted",
        requestId: null,
        path: TITLE,
      };
      say(started);
      expect(on.onInlineEditStarted).toHaveBeenLastCalledWith(null, TITLE);
      expect(of("stopInlineEdit")).toEqual([]);
      say({ val: VAL_CANVAS_MESSAGE, type: "inlineEditEnded", path: TITLE });
      say(started);
      expect(of("stopInlineEdit")).toHaveLength(1);
    });
  });
});
