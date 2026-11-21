/**
 * @jest-environment jsdom
 */
import { act, render } from "@testing-library/react";
import {
  INLINE_EDITOR_ATTRIBUTE,
  VAL_CANVAS_MESSAGE,
  type ValCanvasPageMessage,
  type ValCanvasStudioMessage,
} from "@valbuild/shared/internal";
import { ValCanvasBridge } from "./ValCanvasBridge";

/**
 * Editing a field on the page itself: the Studio answers a pick with
 * `editInline`, the page puts the caret in the element that shows the field
 * (`inlineEditing.ts`, which both bindings run), and what is typed goes back
 * as the field's whole value.
 */
describe("the canvas bridge editing a field on the page", () => {
  let posted: ValCanvasPageMessage[];

  const TITLE = '/content/page.val.ts?p="title"';
  const HREF = '/content/page.val.ts?p="href"';

  beforeEach(() => {
    posted = [];
    Reflect.set(
      globalThis,
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // jsdom lays nothing out: every element is on the page unless hidden.
    jest
      .spyOn(Element.prototype, "getClientRects")
      .mockImplementation(function (this: Element) {
        const hidden =
          this instanceof HTMLElement && this.style.display === "none";
        return (hidden ? [] : [{}]) as unknown as DOMRectList;
      });
    jest
      .spyOn(window.parent, "postMessage")
      .mockImplementation((message: unknown) => {
        posted.push(message as ValCanvasPageMessage);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "ResizeObserver");
  });

  /** From the frame's parent -- the Studio here -- or from elsewhere. */
  const tell = (
    message: ValCanvasStudioMessage,
    from: { source: Window | null; origin: string } = {
      source: window.parent,
      origin: window.location.origin,
    },
  ) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: message,
          source: from.source,
          origin: from.origin,
        }),
      );
    });
  const click = (element: Element) =>
    act(() => {
      element.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
  const editInline = (
    candidates: Extract<
      ValCanvasStudioMessage,
      { type: "editInline" }
    >["candidates"],
    requestId = "r1",
  ) =>
    tell({
      val: VAL_CANVAS_MESSAGE,
      type: "editInline",
      requestId,
      candidates,
    });
  const of = <T extends ValCanvasPageMessage["type"]>(type: T) =>
    posted.filter(
      (message): message is Extract<ValCanvasPageMessage, { type: T }> =>
        message.type === type,
    );
  const editor = () =>
    document.querySelector<HTMLElement>(`[${INLINE_EDITOR_ATTRIBUTE}]`);
  const type = (text: string) =>
    act(() => {
      const copy = editor();
      if (copy === null) throw new Error("nothing is being edited");
      copy.textContent = text;
      copy.dispatchEvent(new Event("input", { bubbles: true }));
    });

  const page = () =>
    render(
      <>
        <a href="/people" data-val-path={`${TITLE},${HREF}`}>
          Our people
        </a>
        <p data-val-path={HREF}>Read more at /people today</p>
        <ValCanvasBridge draftMode />
      </>,
    );

  it("edits the field the clicked element shows, and says which", () => {
    const { getByText } = page();
    tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
    click(getByText("Our people"));
    expect(of("clicked")).toHaveLength(1);
    // The link carries two fields. Its text is one of them, and that is the
    // one a caret in it edits.
    editInline([
      { path: HREF, kind: "string", value: "/people" },
      { path: TITLE, kind: "string", value: "Our people" },
    ]);
    expect(of("inlineEditStarted")).toEqual([
      {
        val: VAL_CANVAS_MESSAGE,
        type: "inlineEditStarted",
        requestId: "r1",
        path: TITLE,
      },
    ]);
    expect(editor()?.textContent).toBe("Our people");
  });

  it("sends what is typed, whole, and says when it ends", () => {
    const { getByText } = page();
    tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
    click(getByText("Our people"));
    editInline([{ path: TITLE, kind: "string", value: "Our people" }]);
    type("Our team");
    expect(of("inlineEdit")).toEqual([
      {
        val: VAL_CANVAS_MESSAGE,
        type: "inlineEdit",
        path: TITLE,
        value: "Our team",
      },
    ]);
    tell({ val: VAL_CANVAS_MESSAGE, type: "stopInlineEdit" });
    expect(of("inlineEditEnded")).toEqual([
      { val: VAL_CANVAS_MESSAGE, type: "inlineEditEnded", path: TITLE },
    ]);
  });

  it("says so when no element shows the field and nothing else", () => {
    page();
    // On the page, but inside a sentence: not the element's to type.
    editInline([{ path: HREF, kind: "string", value: "/people" }], "r2");
    expect(of("inlineEditUnavailable")).toEqual([
      {
        val: VAL_CANVAS_MESSAGE,
        type: "inlineEditUnavailable",
        requestId: "r2",
      },
    ]);
    expect(editor()).toBeNull();
  });

  it("a click in the field being typed in is neither a pick nor the page's", () => {
    const { getByText } = page();
    tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
    click(getByText("Our people"));
    editInline([{ path: TITLE, kind: "string", value: "Our people" }]);
    const copy = editor();
    if (copy === null) throw new Error("nothing is being edited");
    const pageClicks = jest.fn();
    document.body.addEventListener("click", pageClicks);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      copy.dispatchEvent(event);
    });
    document.body.removeEventListener("click", pageClicks);
    // Still the one pick that started it, the link was not followed, and
    // nothing of the page's heard it.
    expect(of("clicked")).toHaveLength(1);
    expect(event.defaultPrevented).toBe(true);
    expect(pageClicks).not.toHaveBeenCalled();
  });

  it("Esc ends the edit, not Select", () => {
    const { getByText } = page();
    tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
    click(getByText("Our people"));
    editInline([{ path: TITLE, kind: "string", value: "Our people" }]);
    act(() => {
      editor()?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(of("inlineEditEnded")).toHaveLength(1);
    expect(of("pickingStopped")).toEqual([]);
  });

  it("the next edit takes over from the last", () => {
    const { getByText } = render(
      <>
        <h1 data-val-path={TITLE}>Our people</h1>
        <h2 data-val-path={HREF}>Since 2012</h2>
        <ValCanvasBridge draftMode />
      </>,
    );
    tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
    click(getByText("Our people"));
    editInline([{ path: TITLE, kind: "string", value: "Our people" }], "r1");
    type("Our team");
    editInline([{ path: HREF, kind: "string", value: "Since 2012" }], "r2");
    // The first ended and gave its element back, before the second began.
    expect(
      posted
        .filter((message) => message.type.startsWith("inlineEdit"))
        .map((message) => message.type),
    ).toEqual([
      "inlineEditStarted",
      "inlineEdit",
      "inlineEditEnded",
      "inlineEditStarted",
    ]);
    expect(
      document.querySelectorAll(`[${INLINE_EDITOR_ATTRIBUTE}]`),
    ).toHaveLength(1);
    expect(editor()?.textContent).toBe("Since 2012");
  });

  it("edits for nobody but its parent, the Studio here", () => {
    page();
    editInline([{ path: TITLE, kind: "string", value: "Our people" }]);
    expect(editor()).not.toBeNull();
    tell({ val: VAL_CANVAS_MESSAGE, type: "stopInlineEdit" });
    posted = [];
    // Another window holding a handle on this one.
    tell(
      {
        val: VAL_CANVAS_MESSAGE,
        type: "editInline",
        requestId: "r9",
        candidates: [{ path: TITLE, kind: "string", value: "Our people" }],
      },
      { source: null, origin: "https://elsewhere.example" },
    );
    expect(
      posted.filter((message) => message.type.startsWith("inlineEdit")),
    ).toEqual([]);
  });

  const BODY = '/content/page.val.ts?p="body"';
  const body = [{ tag: "p", children: ["We are forty people."] }];
  const bold = [
    {
      tag: "p",
      children: [
        "We are ",
        { tag: "span", styles: ["bold"], children: ["forty"] },
        " people.",
      ],
    },
  ];
  const richtextPage = () =>
    render(
      <>
        <div data-val-path={BODY}>
          <p>We are forty people.</p>
        </div>
        <ValCanvasBridge draftMode />
      </>,
    );
  const settle = () =>
    act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  it("says what is selected in a richtext being edited, and where it is", async () => {
    richtextPage();
    editInline([{ path: BODY, kind: "richtext", value: body }]);
    await settle();
    expect(of("inlineEditSelection").at(-1)).toMatchObject({
      path: BODY,
      // At the end of the text, where an edit that no click asked for starts.
      selection: {
        anchor: { block: 0, offset: 20 },
        head: { block: 0, offset: 20 },
      },
      rect: expect.objectContaining({ top: expect.any(Number) }),
    });
  });

  it("shows what one of the Studio's controls made of the text", () => {
    richtextPage();
    editInline([{ path: BODY, kind: "richtext", value: body }]);
    tell({
      val: VAL_CANVAS_MESSAGE,
      type: "applyInlineEdit",
      path: BODY,
      value: bold,
      selection: {
        anchor: { block: 0, offset: 7 },
        head: { block: 0, offset: 12 },
      },
    });
    expect(editor()?.querySelector("span")?.textContent).toBe("forty");
    expect(document.getSelection()?.toString()).toBe("forty");
    // The Studio made it: the page does not send it back.
    expect(of("inlineEdit")).toEqual([]);
  });

  it("...for nobody but its parent, and only in the text being edited", () => {
    richtextPage();
    editInline([{ path: BODY, kind: "richtext", value: body }]);
    const apply: ValCanvasStudioMessage = {
      val: VAL_CANVAS_MESSAGE,
      type: "applyInlineEdit",
      path: BODY,
      value: bold,
      selection: null,
    };
    tell(apply, { source: null, origin: "https://elsewhere.example" });
    expect(editor()?.querySelector("span")).toBeNull();
    tell({ ...apply, path: TITLE });
    expect(editor()?.querySelector("span")).toBeNull();
    tell(apply);
    expect(editor()?.querySelector("span")).not.toBeNull();
  });

  describe("a click that starts the edit by itself", () => {
    /** The Studio saying ahead of a click what the page's texts hold. */
    const textFields = (
      editable: Extract<
        ValCanvasStudioMessage,
        { type: "textFields" }
      >["editable"],
      from?: { source: Window | null; origin: string },
    ) =>
      tell(
        {
          val: VAL_CANVAS_MESSAGE,
          type: "textFields",
          editing: true,
          editable,
          empty: [],
        },
        from,
      );
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        (document.activeElement ?? document.body).dispatchEvent(event);
      });
      return event;
    };

    it("starts in the click, with no round trip, when the Studio said what the text holds", () => {
      const { getByText } = page();
      tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
      textFields([{ path: TITLE, kind: "string", value: "Our people" }]);
      click(getByText("Our people"));
      expect(of("clicked")).toEqual([]);
      expect(of("inlineEditStarted")).toEqual([
        {
          val: VAL_CANVAS_MESSAGE,
          type: "inlineEditStarted",
          requestId: null,
          path: TITLE,
        },
      ]);
      // The caret is in it at once: a key pressed now goes into the text.
      expect(document.activeElement).toBe(editor());
      type("Our team");
      expect(of("inlineEdit").at(-1)).toMatchObject({
        path: TITLE,
        value: "Our team",
      });
    });

    it("asks, as before, when the text no longer holds what the Studio said, and keeps the keys pressed meanwhile", () => {
      const { getByText } = page();
      tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
      // Said before the page re-rendered with the latest edit.
      textFields([{ path: TITLE, kind: "string", value: "Our peopl" }]);
      const pageHeard = jest.fn();
      document.body.addEventListener("keydown", pageHeard);
      click(getByText("Our people"));
      expect(of("clicked")).toHaveLength(1);
      expect(editor()).toBeNull();
      // Typed before the Studio answered: nothing on the page hears it.
      const typed = press("!");
      expect(typed.defaultPrevented).toBe(true);
      expect(pageHeard).not.toHaveBeenCalled();
      document.body.removeEventListener("keydown", pageHeard);
      editInline([{ path: TITLE, kind: "string", value: "Our people" }]);
      // Into the text, once it is there, and after the Studio heard it began.
      expect(editor()?.textContent).toBe("Our people!");
      const types = posted
        .filter((message) => message.type.startsWith("inlineEdit"))
        .map((message) => message.type);
      expect(types.slice(0, 2)).toEqual(["inlineEditStarted", "inlineEdit"]);
      expect(of("inlineEdit").at(-1)).toMatchObject({ value: "Our people!" });
    });

    it("drops the keys held when the field is opened in the column instead", () => {
      const { getByText } = page();
      tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
      textFields([{ path: TITLE, kind: "string", value: "Something else" }]);
      click(getByText("Our people"));
      press("x");
      editInline([{ path: TITLE, kind: "string", value: "Something else" }]);
      expect(of("inlineEditUnavailable")).toHaveLength(1);
      expect(of("inlineEdit")).toEqual([]);
      expect(getByText("Our people").textContent).toBe("Our people");
      // And the page has its keyboard back.
      expect(press("y").defaultPrevented).toBe(false);
    });

    it("an answer to a click from before it does not take the caret away", () => {
      const { getByText } = render(
        <>
          <h1 data-val-path={TITLE}>Our people</h1>
          <h2 data-val-path={HREF}>Since 2012</h2>
          <ValCanvasBridge draftMode />
        </>,
      );
      tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
      textFields([{ path: TITLE, kind: "string", value: "Our people" }]);
      // The Studio is asked about the subheading, which it said nothing of...
      click(getByText("Since 2012"));
      expect(of("clicked")).toHaveLength(1);
      // ...and before it answers, the heading is clicked and typed in.
      click(getByText("Our people"));
      expect(editor()?.textContent).toBe("Our people");
      editInline([{ path: HREF, kind: "string", value: "Since 2012" }], "r1");
      expect(of("inlineEditUnavailable")).toEqual([
        {
          val: VAL_CANVAS_MESSAGE,
          type: "inlineEditUnavailable",
          requestId: "r1",
        },
      ]);
      expect(editor()?.textContent).toBe("Our people");
      expect(document.activeElement).toBe(editor());
    });

    it("only in Select & edit, and only as the Studio here says", () => {
      const { getByText } = page();
      tell({ val: VAL_CANVAS_MESSAGE, type: "setPicking", picking: true });
      // From another window: not heard.
      textFields([{ path: TITLE, kind: "string", value: "Our people" }], {
        source: null,
        origin: "https://elsewhere.example",
      });
      click(getByText("Our people"));
      expect(editor()).toBeNull();
      expect(of("clicked")).toHaveLength(1);
      // Plain Select: a click is a pick, as it always was.
      tell({
        val: VAL_CANVAS_MESSAGE,
        type: "textFields",
        editing: false,
        editable: [],
        empty: [],
      });
      click(getByText("Our people"));
      expect(editor()).toBeNull();
      expect(of("clicked")).toHaveLength(2);
    });
  });
});
