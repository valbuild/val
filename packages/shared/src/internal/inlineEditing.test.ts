/** @jest-environment jsdom */
import {
  canEditInline,
  INLINE_EDITOR_ATTRIBUTE,
  INLINE_ORIGINAL_ATTRIBUTE,
  startInlineEditing,
  type InlineEditCandidate,
  type InlineEditValue,
  type InlineRichTextNode,
  type InlineSelection,
} from "./inlineEditing";

/*
 * jsdom lays nothing out, so every element is "not on the page" until told
 * otherwise; and it has no editing of its own, so a keystroke here is what a
 * browser's would leave behind: the text changed, then `input`. What a real
 * browser does with the keys themselves is Chromium's to show, in
 * `e2e/inlineEditingSuite.ts`.
 */
beforeEach(() => {
  document.body.innerHTML = "";
  jest.spyOn(Element.prototype, "getClientRects").mockImplementation(function (
    this: Element,
  ) {
    const hidden = this instanceof HTMLElement && this.style.display === "none";
    return (hidden ? [] : [{}]) as unknown as DOMRectList;
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function page(html: string): HTMLElement {
  const root = document.createElement("main");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const editor = () =>
  document.querySelector<HTMLElement>(`[${INLINE_EDITOR_ATTRIBUTE}]`);

function start(
  element: Element,
  candidate: InlineEditCandidate,
  settleMs?: number,
) {
  const changes: InlineEditValue[] = [];
  const onEnd = jest.fn();
  const editing = startInlineEditing(element, candidate, {
    color: "#079455",
    onChange: (value) => changes.push(value),
    onEnd,
    ...(settleMs !== undefined ? { settleMs } : {}),
  });
  return { editing, changes, onEnd };
}

/** What typing leaves behind: the copy changed, and the browser said so. */
function typed(change: (copy: HTMLElement) => void) {
  const copy = editor();
  if (copy === null) throw new Error("nothing is being edited");
  change(copy);
  copy.dispatchEvent(new Event("input", { bubbles: true }));
}

function caret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function beforeInput(inputType: string, data?: string): boolean {
  const copy = editor();
  if (copy === null) throw new Error("nothing is being edited");
  return copy.dispatchEvent(
    new InputEvent("beforeinput", {
      inputType,
      bubbles: true,
      cancelable: true,
      ...(data !== undefined ? { data } : {}),
    }),
  );
}

const title: InlineEditCandidate = {
  path: '/app/page.val.ts?p="title"',
  kind: "string",
  value: "Our people",
};

describe("what can be edited where it is shown", () => {
  test("a string, by the element that shows it and nothing else", () => {
    const root = page(`<h1>Our people</h1>`);
    expect(canEditInline(root.querySelector("h1")!, title)).toBe(true);
  });

  test("not where the element shows more than the string, or less", () => {
    const root = page(
      `<p id="mixed">Meet Our people!</p><p id="nested"><b>Our people</b></p><img id="alt" alt="Our people"><input id="input" value="Our people">`,
    );
    for (const id of ["mixed", "nested", "alt", "input"]) {
      expect(canEditInline(root.querySelector(`#${id}`)!, title)).toBe(false);
    }
  });

  test("not an element that is not on the page", () => {
    const root = page(`<h1 style="display: none">Our people</h1>`);
    expect(canEditInline(root.querySelector("h1")!, title)).toBe(false);
  });

  const body: InlineRichTextNode[] = [
    { tag: "h2", children: ["Who we are"] },
    {
      tag: "p",
      children: [
        "We are ",
        { tag: "span", styles: ["bold"], children: ["forty"] },
        " people. ",
        { tag: "a", href: "/jobs", children: ["Join us"] },
      ],
    },
  ];
  const rendered = `<div><h2 class="t">Who we are</h2><p>We are <span class="font-bold">forty</span> people. <a href="/jobs">Join us</a></p></div>`;

  test("a richtext, by the element whose children are its nodes", () => {
    const root = page(rendered);
    expect(
      canEditInline(root.firstElementChild!, {
        path: "body",
        kind: "richtext",
        value: body,
      }),
    ).toBe(true);
  });

  test("not where the page rendered it as something else", () => {
    // A `transform` that wraps, drops or rewrites: the copy could not be
    // read back as the document.
    const wrapped = page(
      `<div><section><h2>Who we are</h2></section><p>We are <span>forty</span> people. <a href="/jobs">Join us</a></p></div>`,
    );
    const reworded = page(rendered.replace("forty", "40"));
    for (const root of [wrapped, reworded]) {
      expect(
        canEditInline(root.firstElementChild!, {
          path: "body",
          kind: "richtext",
          value: body,
        }),
      ).toBe(false);
    }
  });

  test("not a document with a node this cannot edit around", () => {
    const root = page(`<div><blockquote><p>Quoted</p></blockquote></div>`);
    expect(
      canEditInline(root.firstElementChild!, {
        path: "body",
        kind: "richtext",
        value: [
          { tag: "blockquote", children: [{ tag: "p", children: ["Quoted"] }] },
        ],
      }),
    ).toBe(false);
  });
});

describe("editing a string on the page", () => {
  test("is refused, with nothing touched, where the element does not show it", () => {
    const root = page(`<p>Meet Our people!</p>`);
    const { editing } = start(root.querySelector("p")!, title);
    expect(editing).toBeNull();
    expect(root.innerHTML).toBe(`<p>Meet Our people!</p>`);
  });

  test("a copy stands in for the page's element, which is hidden and left alone", () => {
    const root = page(`<h1 class="text-4xl" data-val-path="t">Our people</h1>`);
    const original = root.querySelector("h1")!;
    const { editing } = start(original, title);
    expect(editing?.path).toBe(title.path);
    const copy = editor()!;
    expect(copy).not.toBe(original);
    expect(copy.className).toBe("text-4xl");
    expect(copy.textContent).toBe("Our people");
    expect(copy.getAttribute("contenteditable")).not.toBeNull();
    // Still carrying the path, so the Studio's list of what is on the page
    // keeps the field while it is edited.
    expect(copy.getAttribute("data-val-path")).toBe("t");
    expect(original.hasAttribute(INLINE_ORIGINAL_ATTRIBUTE)).toBe(true);
    expect(original.hidden).toBe(true);
    expect(original.style.display).toBe("none");
    expect(original.textContent).toBe("Our people");
  });

  test("the copy answers :first-child as the element did", () => {
    const root = page(`<h1>Our people</h1><p>Intro</p>`);
    start(root.querySelector("h1")!, title);
    expect(root.firstElementChild).toBe(editor());
  });

  test("what is typed is reported whole, once per change", () => {
    const root = page(`<h1>Our people</h1>`);
    const { changes } = start(root.querySelector("h1")!, title);
    typed((copy) => (copy.textContent = "Our people!"));
    typed((copy) => (copy.textContent = "Our people!"));
    typed((copy) => (copy.textContent = "Our team"));
    expect(changes).toEqual(["Our people!", "Our team"]);
  });

  test("the page writing to its own element does not reach what is typed", () => {
    const root = page(`<h1>Our people</h1>`);
    const original = root.querySelector("h1")!;
    start(original, title);
    typed((copy) => (copy.textContent = "Our people, all of them"));
    // The echo of an earlier keystroke, as the framework renders it.
    original.textContent = "Our people, all";
    expect(editor()!.textContent).toBe("Our people, all of them");
  });

  test("Enter ends a single line, and the copy waits for the page to show it", () => {
    const root = page(`<h1>Our people</h1>`);
    const original = root.querySelector("h1")!;
    const { editing, onEnd } = start(original, title);
    typed((copy) => (copy.textContent = "Our team"));
    editor()!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(editing?.isActive()).toBe(false);
    // The page still shows the text from before: the copy stays, read-only.
    expect(editor()?.getAttribute("contenteditable")).toBe("false");
    expect(original.hidden).toBe(true);
  });

  test("...and gives way once it does", async () => {
    const root = page(`<h1>Our people</h1>`);
    const original = root.querySelector("h1")!;
    const { editing } = start(original, title);
    typed((copy) => (copy.textContent = "Our team"));
    editing?.stop();
    original.textContent = "Our team";
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor()).toBeNull();
    expect(original.hidden).toBe(false);
    expect(original.hasAttribute(INLINE_ORIGINAL_ATTRIBUTE)).toBe(false);
    expect(original.getAttribute("style")).toBeNull();
  });

  test("...or after a short wait, when the page never does", () => {
    jest.useFakeTimers();
    const root = page(`<h1>Our people</h1>`);
    const original = root.querySelector("h1")!;
    const { editing } = start(original, title, 500);
    typed((copy) => (copy.textContent = "Our team"));
    editing?.stop();
    jest.advanceTimersByTime(499);
    expect(editor()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(editor()).toBeNull();
    expect(original.hidden).toBe(false);
  });

  test("an unchanged field gives way at once", () => {
    const root = page(`<h1>Our people</h1>`);
    const { editing, changes, onEnd } = start(root.querySelector("h1")!, title);
    editing?.stop();
    editing?.stop();
    expect(editor()).toBeNull();
    expect(changes).toEqual([]);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  test("Esc ends it, and the page's own shortcuts never see the keys", () => {
    const root = page(`<h1>Our people</h1>`);
    const { onEnd } = start(root.querySelector("h1")!, title);
    const pageKeys = jest.fn();
    document.addEventListener("keydown", pageKeys);
    const copy = editor()!;
    copy.dispatchEvent(
      new KeyboardEvent("keydown", { key: "/", bubbles: true }),
    );
    expect(onEnd).not.toHaveBeenCalled();
    copy.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    document.removeEventListener("keydown", pageKeys);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(pageKeys).not.toHaveBeenCalled();
  });

  test("the focus leaving ends it", () => {
    const root = page(`<h1>Our people</h1><button>Elsewhere</button>`);
    const { onEnd } = start(root.querySelector("h1")!, title);
    editor()!.dispatchEvent(
      new FocusEvent("focusout", {
        bubbles: true,
        relatedTarget: root.querySelector("button"),
      }),
    );
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  test("a paste is text, on one line", () => {
    const root = page(`<h1>Our people</h1>`);
    const { changes } = start(root.querySelector("h1")!, title);
    const copy = editor()!;
    caret(copy.firstChild!, "Our people".length);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Reflect.set(paste, "clipboardData", {
      getData: (type: string) =>
        type === "text/plain" ? ",\n  <b>all</b> of us" : "<i>markup</i>",
    });
    copy.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(copy.children.length).toBe(0);
    expect(changes).toEqual(["Our people, <b>all</b> of us"]);
  });

  test("a multiline string keeps its Enter, and a pasted line break", () => {
    const root = page(`<p>Our people</p>`);
    const { onEnd, changes } = start(root.querySelector("p")!, {
      ...title,
      multiline: true,
    });
    const copy = editor()!;
    copy.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    expect(onEnd).not.toHaveBeenCalled();
    caret(copy.firstChild!, "Our people".length);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Reflect.set(paste, "clipboardData", { getData: () => "\r\nand more" });
    copy.dispatchEvent(paste);
    expect(changes).toEqual(["Our people\nand more"]);
  });

  test("the page taking its element away ends it and takes the copy with it", async () => {
    const root = page(`<h1>Our people</h1>`);
    const original = root.querySelector("h1")!;
    const { onEnd } = start(original, title);
    original.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(editor()).toBeNull();
  });

  test("release gives the element back at once, whatever it shows", () => {
    const root = page(`<h1>Our people</h1>`);
    const original = root.querySelector("h1")!;
    const { editing, onEnd } = start(original, title);
    typed((copy) => (copy.textContent = "Our team"));
    editing?.release();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(editor()).toBeNull();
    expect(original.hidden).toBe(false);
  });
});

describe("editing a richtext on the page", () => {
  const body: InlineRichTextNode[] = [
    { tag: "h2", children: ["Who we are"] },
    {
      tag: "p",
      children: [
        "We are ",
        { tag: "span", styles: ["bold"], children: ["forty"] },
        " people. ",
        { tag: "a", href: "/jobs", children: ["Join us"] },
      ],
    },
    { tag: "p", children: ["Since 2012."] },
    {
      tag: "ul",
      children: [
        { tag: "li", children: [{ tag: "p", children: ["Oslo"] }] },
        { tag: "li", children: [{ tag: "p", children: ["Bergen"] }] },
      ],
    },
  ];
  const rendered = `<div class="prose"><h2 class="t">Who we are</h2><p class="p">We are <span class="font-bold">forty</span> people. <a href="/jobs" class="underline">Join us</a></p><p class="p">Since 2012.</p><ul class="ul"><li class="li"><p class="p">Oslo</p></li><li class="li"><p class="p">Bergen</p></li></ul></div>`;
  const candidate: InlineEditCandidate = {
    path: "body",
    kind: "richtext",
    value: body,
  };
  const begin = () => {
    const root = page(rendered);
    const original = root.firstElementChild!;
    return { original, ...start(original, candidate) };
  };
  const last = (changes: InlineEditValue[]) => changes[changes.length - 1];

  test("text typed inside a mark stays in the mark, and the rest is as it was", () => {
    const { changes } = begin();
    typed((copy) => {
      copy.querySelector("span")!.firstChild!.nodeValue = "forty-two";
    });
    expect(changes).toEqual([
      [
        body[0],
        {
          tag: "p",
          children: [
            "We are ",
            { tag: "span", styles: ["bold"], children: ["forty-two"] },
            " people. ",
            { tag: "a", href: "/jobs", children: ["Join us"] },
          ],
        },
        body[2],
        body[3],
      ],
    ]);
  });

  test("a mark or a link with nothing left in it is gone", () => {
    const { changes } = begin();
    typed((copy) => {
      copy.querySelector("span")!.textContent = "";
      copy.querySelector("a")!.textContent = "";
    });
    expect(last(changes)).toEqual([
      body[0],
      { tag: "p", children: ["We are  people. "] },
      body[2],
      body[3],
    ]);
  });

  test("Enter makes two paragraphs of one, each keeping its part", () => {
    const { changes } = begin();
    const copy = editor()!;
    // "We are for|ty people."
    caret(copy.querySelector("span")!.firstChild!, 3);
    expect(beforeInput("insertParagraph")).toBe(false);
    expect(last(changes)).toEqual([
      body[0],
      {
        tag: "p",
        children: [
          "We are ",
          { tag: "span", styles: ["bold"], children: ["for"] },
        ],
      },
      {
        tag: "p",
        children: [
          { tag: "span", styles: ["bold"], children: ["ty"] },
          " people. ",
          { tag: "a", href: "/jobs", children: ["Join us"] },
        ],
      },
      body[2],
      body[3],
    ]);
    // The new paragraph is classed as the document's own are.
    expect(copy.querySelectorAll("p.p").length).toBe(5);
  });

  test("Enter at the end of a heading starts a paragraph, not a second heading", () => {
    const { changes } = begin();
    const heading = editor()!.querySelector("h2")!;
    caret(heading.firstChild!, "Who we are".length);
    beforeInput("insertParagraph");
    expect(last(changes)).toEqual([
      body[0],
      { tag: "p", children: [] },
      body[1],
      body[2],
      body[3],
    ]);
  });

  test("Enter in a list item makes a new item", () => {
    const { changes } = begin();
    caret(editor()!.querySelector("li p")!.firstChild!, 2);
    beforeInput("insertParagraph");
    expect(last(changes)).toEqual([
      body[0],
      body[1],
      body[2],
      {
        tag: "ul",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["Os"] }] },
          { tag: "li", children: [{ tag: "p", children: ["lo"] }] },
          { tag: "li", children: [{ tag: "p", children: ["Bergen"] }] },
        ],
      },
    ]);
  });

  test("Backspace at the start of a paragraph joins it to the one before, marks and all", () => {
    const { changes } = begin();
    const second = editor()!.querySelectorAll("p")[0];
    caret(second.firstChild!, 0);
    expect(beforeInput("deleteContentBackward")).toBe(false);
    expect(last(changes)).toEqual([
      {
        tag: "h2",
        children: [
          "Who we areWe are ",
          { tag: "span", styles: ["bold"], children: ["forty"] },
          " people. ",
          { tag: "a", href: "/jobs", children: ["Join us"] },
        ],
      },
      body[2],
      body[3],
    ]);
  });

  test("Delete at the end of the last item of a list joins nothing and breaks nothing", () => {
    const { changes } = begin();
    const lastItem = editor()!.querySelectorAll("li p")[1];
    caret(lastItem.firstChild!, "Bergen".length);
    expect(beforeInput("deleteContentForward")).toBe(false);
    expect(changes).toEqual([]);
  });

  test("Delete at the end of an item joins the next, and the emptied item goes", () => {
    const { changes } = begin();
    const first = editor()!.querySelector("li p")!;
    caret(first.firstChild!, "Oslo".length);
    beforeInput("deleteContentForward");
    expect(last(changes)).toEqual([
      body[0],
      body[1],
      body[2],
      {
        tag: "ul",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["OsloBergen"] }] },
        ],
      },
    ]);
  });

  test("typing over a selection across blocks leaves one block", () => {
    const { changes } = begin();
    const copy = editor()!;
    const range = document.createRange();
    range.setStart(copy.querySelector("h2")!.firstChild!, "Who".length);
    range.setEnd(copy.querySelectorAll("p")[1].firstChild!, "Since".length);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(beforeInput("insertText", "!")).toBe(false);
    expect(last(changes)).toEqual([
      { tag: "h2", children: ["Who! 2012."] },
      body[3],
    ]);
  });

  test("everything deleted leaves a block to type in", () => {
    const { changes } = begin();
    const copy = editor()!;
    const range = document.createRange();
    range.selectNodeContents(copy);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    beforeInput("deleteContentBackward");
    expect(last(changes)).toEqual([{ tag: "p", children: [] }]);
    expect(copy.querySelectorAll("p.p").length).toBe(1);
  });

  test("the browser's own formatting is refused: a mark's class is the page's to give", () => {
    begin();
    expect(beforeInput("formatBold")).toBe(false);
  });

  test("a line break pasted into a paragraph is a space", () => {
    const { changes } = begin();
    const copy = editor()!;
    caret(copy.querySelectorAll("p")[1].firstChild!, "Since".length);
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Reflect.set(paste, "clipboardData", { getData: () => "\n way back\nin" });
    copy.dispatchEvent(paste);
    expect(last(changes)).toEqual([
      body[0],
      body[1],
      { tag: "p", children: ["Since way back in 2012."] },
      body[3],
    ]);
  });

  test("the page's element is never the one edited", () => {
    const { original } = begin();
    const before = original.innerHTML;
    caret(editor()!.querySelector("span")!.firstChild!, 3);
    beforeInput("insertParagraph");
    expect(original.innerHTML).toBe(before);
  });
});

describe("the Studio's controls for a richtext on the page", () => {
  const body: InlineRichTextNode[] = [
    { tag: "h2", children: ["Who we are"] },
    {
      tag: "p",
      children: [
        "We are ",
        { tag: "span", styles: ["bold"], children: ["forty"] },
        " people.",
        { tag: "br" },
        "Since 2012.",
      ],
    },
  ];
  const rendered = `<div class="prose"><h2 class="t">Who we are</h2><p class="p">We are <span class="font-bold">forty</span> people.<br>Since 2012.</p></div>`;
  const begin = () => {
    const root = page(rendered);
    const original = root.firstElementChild!;
    const changes: InlineEditValue[] = [];
    const selections: (InlineSelection | null)[] = [];
    const editing = startInlineEditing(
      original,
      { path: "body", kind: "richtext", value: body },
      {
        color: "#079455",
        onChange: (value) => changes.push(value),
        onEnd: () => undefined,
        onSelection: (selection) => selections.push(selection),
      },
    );
    return { original, editing, changes, selections };
  };
  /** The selection is told a turn later, once per turn. */
  const told = () => new Promise((resolve) => setTimeout(resolve, 0));
  const lastOf = <T>(list: T[]) => list[list.length - 1];

  test("is told where the caret is, as a place in the document", async () => {
    const { selections } = begin();
    const copy = editor()!;
    // "We are for|ty people.": seven characters, then three into the mark.
    caret(copy.querySelector("span")!.firstChild!, 3);
    document.dispatchEvent(new Event("selectionchange"));
    await told();
    expect(lastOf(selections)).toEqual({
      anchor: { block: 1, offset: 10 },
      head: { block: 1, offset: 10 },
    });
  });

  test("a line break counts as one, as the Studio's editor counts it", async () => {
    const { selections } = begin();
    const paragraph = editor()!.querySelector("p")!;
    // After the <br>: "We are forty people." is 20, the break makes 21.
    caret(paragraph.lastChild!, 0);
    document.dispatchEvent(new Event("selectionchange"));
    await told();
    expect(lastOf(selections)?.head).toEqual({ block: 1, offset: 21 });
  });

  test("a selection is told with both its ends", async () => {
    const { selections } = begin();
    const copy = editor()!;
    document
      .getSelection()!
      .setBaseAndExtent(
        copy.querySelector("h2")!.firstChild!,
        4,
        copy.querySelector("p")!.firstChild!,
        2,
      );
    document.dispatchEvent(new Event("selectionchange"));
    await told();
    expect(lastOf(selections)).toEqual({
      anchor: { block: 0, offset: 4 },
      head: { block: 1, offset: 2 },
    });
  });

  test("a string has no selection to tell, but says where it is", async () => {
    // Where its validation errors are drawn: a string has no controls,
    // but its errors belong by it as much as a richtext's do.
    const root = page(`<h1>Our people</h1>`);
    const onSelection = jest.fn();
    startInlineEditing(root.querySelector("h1")!, title, {
      color: "#079455",
      onChange: () => undefined,
      onEnd: () => undefined,
      onSelection,
    });
    document.dispatchEvent(new Event("selectionchange"));
    await told();
    expect(onSelection).toHaveBeenCalled();
    for (const [selection, rect] of onSelection.mock.calls) {
      expect(selection).toBeNull();
      expect(rect).toEqual(
        expect.objectContaining({ top: expect.any(Number) }),
      );
    }
  });

  const italic: InlineRichTextNode[] = [
    { tag: "h2", children: ["Who we are"] },
    {
      tag: "p",
      children: [
        "We ",
        { tag: "span", styles: ["italic"], children: ["are"] },
        " ",
        { tag: "span", styles: ["bold"], children: ["forty"] },
        " people.",
        { tag: "br" },
        "Since 2012.",
      ],
    },
  ];

  test("what a control made of the document is shown, classed as the page classes its own", () => {
    const { editing, changes } = begin();
    editing?.apply(italic, {
      anchor: { block: 1, offset: 3 },
      head: { block: 1, offset: 6 },
    });
    const copy = editor()!;
    // The bold word keeps the page's class; the heading and paragraph too.
    expect(copy.querySelector("h2")!.className).toBe("t");
    expect(copy.querySelector("p")!.className).toBe("p");
    const [made, bold] = Array.from(copy.querySelectorAll("span"));
    expect(bold.className).toBe("font-bold");
    // No italic word on the page yet to take the class of: shown as one.
    expect(made.textContent).toBe("are");
    expect(made.style.fontStyle).toBe("italic");
    // What was selected still is.
    expect(document.getSelection()!.toString()).toBe("are");
    // The Studio made it, so it is not told of it.
    expect(changes).toEqual([]);
  });

  test("...and typing goes on from it", () => {
    const { editing, changes } = begin();
    editing?.apply(italic, null);
    typed((copy) => {
      copy.querySelector("h2")!.firstChild!.nodeValue = "Who we were";
    });
    expect(lastOf(changes)).toEqual([
      { tag: "h2", children: ["Who we were"] },
      italic[1],
    ]);
  });

  test("...and it is drawn again from the page's own element, once that shows it", async () => {
    const { editing, original } = begin();
    editing?.apply(italic, {
      anchor: { block: 1, offset: 3 },
      head: { block: 1, offset: 6 },
    });
    // The page renders the edit, with the class its theme gives italic.
    original.innerHTML = `<h2 class="t">Who we are</h2><p class="p">We <span class="font-italic">are</span> <span class="font-bold">forty</span> people.<br>Since 2012.</p>`;
    await told();
    const made = editor()!.querySelector("span")!;
    expect(made.className).toBe("font-italic");
    expect(made.style.fontStyle).toBe("");
    expect(document.getSelection()!.toString()).toBe("are");
  });

  test("...but not while more has been typed than the page shows", async () => {
    const { editing, original } = begin();
    editing?.apply(italic, null);
    typed((copy) => {
      copy.querySelector("h2")!.firstChild!.nodeValue = "Who we were";
    });
    original.innerHTML = `<h2 class="t">Who we are</h2><p class="p">We <span class="font-italic">are</span> <span class="font-bold">forty</span> people.<br>Since 2012.</p>`;
    await told();
    // The copy is what the person is looking at, and it stays.
    expect(editor()!.querySelector("h2")!.textContent).toBe("Who we were");
    expect(editor()!.querySelector("span")!.className).toBe("");
  });

  test("a paragraph made a heading is a heading, and one made a list is a list", () => {
    const { editing, changes } = begin();
    const restructured: InlineRichTextNode[] = [
      { tag: "h2", children: ["Who we are"] },
      { tag: "h2", children: ["We are forty people."] },
      {
        tag: "ul",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["Since 2012."] }] },
        ],
      },
    ];
    editing?.apply(restructured, null);
    const copy = editor()!;
    expect(copy.querySelectorAll("h2")).toHaveLength(2);
    expect(copy.querySelectorAll("h2")[1].className).toBe("t");
    expect(copy.querySelector("ul > li > p")!.textContent).toBe("Since 2012.");
    typed((el) => {
      el.querySelector("li p")!.firstChild!.nodeValue = "Since 2011.";
    });
    expect(lastOf(changes)).toEqual([
      restructured[0],
      restructured[1],
      {
        tag: "ul",
        children: [
          { tag: "li", children: [{ tag: "p", children: ["Since 2011."] }] },
        ],
      },
    ]);
  });

  test("nothing this cannot edit around is put on the page", () => {
    const { editing } = begin();
    const before = editor()!.innerHTML;
    editing?.apply(
      [
        { tag: "script", children: ["alert(1)"] },
        { tag: "p", children: [] },
      ],
      null,
    );
    expect(editor()!.innerHTML).toBe(before);
  });

  test("the focus leaving the PAGE does not end it: the controls are out there", async () => {
    const root = page(rendered);
    const onEnd = jest.fn();
    startInlineEditing(
      root.firstElementChild!,
      { path: "body", kind: "richtext", value: body },
      { color: "#079455", onChange: () => undefined, onEnd },
    );
    // To nothing the page can name: the Studio around it, another window.
    editor()!.blur();
    await told();
    expect(onEnd).not.toHaveBeenCalled();
  });

  test("...and a press elsewhere on the page does, but not one in the text", () => {
    const root = page(`${rendered}<p id="elsewhere">Elsewhere</p>`);
    const onEnd = jest.fn();
    startInlineEditing(
      root.firstElementChild!,
      { path: "body", kind: "richtext", value: body },
      { color: "#079455", onChange: () => undefined, onEnd },
    );
    const press = (target: Element) =>
      target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    press(editor()!.querySelector("span")!);
    expect(onEnd).not.toHaveBeenCalled();
    press(root.querySelector("#elsewhere")!);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
