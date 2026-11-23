/** @jest-environment jsdom */
import { holdKeys, replayKeys, type HeldKey } from "./inlineEditKeys";
import {
  INLINE_EDITOR_ATTRIBUTE,
  startInlineEditing,
  type InlineEditCandidate,
  type InlineEditValue,
} from "./inlineEditing";

/*
 * jsdom has no editing of its own and no `execCommand`, so what a replayed
 * key types here is `replayKeys`'s own fallback; in a browser it is the
 * browser's editing, which `e2e/inlineEditingSuite.ts` types through.
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

const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.body.dispatchEvent(event);
  return event;
};
const key = (name: string, init: Partial<HeldKey> = {}): HeldKey => ({
  key: name,
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...init,
});

function editing(html: string, candidate: InlineEditCandidate) {
  document.body.innerHTML = html;
  const element = document.body.firstElementChild;
  if (element === null) throw new Error("no element");
  const changes: InlineEditValue[] = [];
  const onEnd = jest.fn();
  const started = startInlineEditing(element, candidate, {
    color: "#079455",
    onChange: (value) => changes.push(value),
    onEnd,
  });
  if (started === null) throw new Error("did not start");
  const copy = document.querySelector<HTMLElement>(
    `[${INLINE_EDITOR_ATTRIBUTE}]`,
  );
  if (copy === null) throw new Error("no copy");
  return { started, copy, changes, onEnd };
}

describe("holding the keys pressed before the edit starts", () => {
  it("holds them, in order, and nothing on the page hears them", () => {
    const pageHeard = jest.fn();
    document.body.addEventListener("keydown", pageHeard);
    const held = holdKeys(window);
    const typed = press("a");
    press("B", { shiftKey: true });
    press("End");
    expect(typed.defaultPrevented).toBe(true);
    expect(pageHeard).not.toHaveBeenCalled();
    expect(held.release()).toEqual([
      key("a"),
      key("B", { shiftKey: true }),
      key("End"),
    ]);
    // Released: the page has its keyboard back.
    press("c");
    expect(pageHeard).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape, a modifier on its own and a composition to the page", () => {
    const pageHeard = jest.fn();
    document.body.addEventListener("keydown", pageHeard);
    const held = holdKeys(window);
    press("Escape");
    press("Shift", { shiftKey: true });
    press("a", { isComposing: true });
    expect(pageHeard).toHaveBeenCalledTimes(3);
    expect(held.release()).toEqual([]);
  });

  it("gives up after a while, dropping what it held", () => {
    jest.useFakeTimers();
    const held = holdKeys(window, { timeoutMs: 100 });
    press("a");
    jest.advanceTimersByTime(100);
    expect(press("b").defaultPrevented).toBe(false);
    expect(held.release()).toEqual([]);
  });
});

describe("replaying them into the text being typed in", () => {
  it("types what was typed, where the caret is, and the edit hears it", () => {
    const { copy, changes } = editing("<h1>Blog 1</h1>", {
      path: "title",
      kind: "string",
      value: "Blog 1",
    });
    replayKeys(document, [key(","), key(" "), key("h"), key("i")]);
    expect(copy.textContent).toBe("Blog 1, hi");
    expect(changes.at(-1)).toBe("Blog 1, hi");
  });

  it("deletes with Backspace, and select-all then a letter replaces it all", () => {
    const { copy, changes } = editing("<h1>Blog 1</h1>", {
      path: "title",
      kind: "string",
      value: "Blog 1",
    });
    replayKeys(document, [key("Backspace")]);
    expect(copy.textContent).toBe("Blog ");
    replayKeys(document, [key("a", { ctrlKey: true }), key("X")]);
    expect(copy.textContent).toBe("X");
    expect(changes.at(-1)).toBe("X");
  });

  it("an Enter that ends a single line ends the replay too", () => {
    const { copy, onEnd } = editing("<h1>Blog 1</h1>", {
      path: "title",
      kind: "string",
      value: "Blog 1",
    });
    replayKeys(document, [key("!"), key("Enter"), key("x")]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    // The key after the Enter went to a page no longer being typed in.
    expect(copy.textContent).toBe("Blog 1!");
  });

  it("Enter in a richtext goes through the edit's own splitting", () => {
    const { copy, changes } = editing("<div><p>One</p></div>", {
      path: "body",
      kind: "richtext",
      value: [{ tag: "p", children: ["One"] }],
    });
    replayKeys(document, [key("Enter"), key("T")]);
    expect(copy.querySelectorAll("p")).toHaveLength(2);
    expect(changes.at(-1)).toEqual([
      { tag: "p", children: ["One"] },
      { tag: "p", children: ["T"] },
    ]);
  });

  it("does nothing when nothing is being typed in", () => {
    document.body.innerHTML = "<h1>Blog 1</h1>";
    replayKeys(document, [key("x")]);
    expect(document.body.textContent).toBe("Blog 1");
  });
});
