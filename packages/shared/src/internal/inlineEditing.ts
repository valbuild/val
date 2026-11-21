/**
 * Editing a field ON the page, in the Studio's preview: a click on a headline
 * puts the caret in the headline.
 *
 * Plain DOM, nothing of React's or the Studio's, and in `shared` for the
 * reason `elementPicker.ts` is: the canvas bridge of each binding
 * (`@valbuild/next`, `@valbuild/tanstack`) runs it inside the page, the only
 * place the page's elements can be reached. What crosses the frame is the
 * value typed (`inlineEdit` in `valCanvasProtocol.ts`), and the Studio writes
 * it as the field in its own column would.
 *
 * ## The page's element is never edited: a copy of it is
 *
 * The element on the page is the framework's. React holds its text nodes and
 * writes to them when the content moves -- and every edit made here comes
 * back as exactly that, a moment later, once the Studio has made a patch of
 * it. Typing into React's own node therefore means the caret jumping to the
 * start on every echo, the letters typed since coming back out, and, once a
 * paragraph has been split or merged, React reconciling against a tree that
 * is no longer the one it built.
 *
 * So the element is hidden and a COPY of it stands in its place, with the
 * same classes and therefore the same look. The copy is nobody's but ours:
 * the person types in it, and the framework goes on updating the hidden
 * original. When editing ends the copy stays until the original shows what
 * was typed (or a short wait runs out), and then the original comes back.
 *
 * ## What can be edited this way
 *
 * - A **string**, when the element shows that string and nothing else: no
 *   child elements, and its text is the value. `<h1>{title}</h1>` is;
 *   `<p>Hi {name}!</p>`, an `alt`, an `href` or a value the page transformed
 *   is not.
 * - A **richtext**, when the element's children are the document's nodes,
 *   tag for tag (what `ValRichText` renders without a `transform` that
 *   changes the structure). Text can be typed and deleted anywhere,
 *   paragraphs and list items split (Enter) and joined (Backspace, Delete),
 *   and the marks, links and images that are there are kept. Nothing NEW can
 *   be formatted here: a mark's class comes from the page's own theme, which
 *   only the page's renderer knows.
 *
 * Anything else is answered with `null`, and the Studio opens the field in
 * its own column instead, as it always has.
 */

/** A node of a richtext document, as its source holds it. */
export type InlineRichTextNode = string | InlineRichTextElement;
export type InlineRichTextElement = {
  readonly tag: string;
  readonly children?: readonly InlineRichTextNode[];
  readonly [key: string]: unknown;
};

/** What a field holds once it has been edited here. */
export type InlineEditValue = string | InlineRichTextNode[];

/**
 * A field the Studio offers for editing in place: its path, what kind it is
 * and what it holds now, which is how the page tells that an element shows
 * it.
 */
export type InlineEditCandidate =
  | {
      path: string;
      kind: "string";
      value: string;
      /** Enter is a new line rather than the end of the edit. */
      multiline?: boolean;
    }
  | { path: string; kind: "richtext"; value: InlineRichTextNode[] };

/**
 * A place in a richtext document: which paragraph or heading, counted in the
 * order they are read, and how far into it. Text counts by the character
 * and an image or a line break as one -- which is how the Studio's editor
 * counts too, so a place means the same on both sides of the frame.
 */
export type InlinePoint = { block: number; offset: number };

/** What is selected in a richtext being edited: from `anchor` to `head`. */
export type InlineSelection = { anchor: InlinePoint; head: InlinePoint };

/** Where the copy being typed in is, in the page's viewport. */
export type InlineRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/** An edit in progress. */
export type InlineEditing = {
  /** The field being edited. */
  path: string;
  /** Whether it is still being typed in: false once it has been stopped. */
  isActive(): boolean;
  /** Whether `node` is in the copy being typed in. */
  contains(node: Node | null): boolean;
  /**
   * End it. The copy stays, no longer editable, until the page's own element
   * shows what was typed, and `onEnd` is called at once.
   */
  stop(): void;
  /**
   * End it and give the page its element back NOW, whatever it shows: for
   * when the element is wanted again, by the next edit or by the page going
   * away.
   */
  release(): void;
  /**
   * Put a whole new document in the copy, with this selected: what one of
   * the Studio's controls made of the document (a word made bold, a
   * paragraph made a heading). A richtext only.
   *
   * Drawn at once with what this can tell of the page's look -- a new node
   * is classed as one of its kind already in the document is -- and again,
   * exactly, once the page's own element has rendered it.
   */
  apply(value: InlineRichTextNode[], selection: InlineSelection | null): void;
  /**
   * Put the caret back in the copy, where it was: the focus went to one of
   * the Studio's controls -- a box to type a link in -- and is done there.
   */
  focus(): void;
};

/** On the copy being typed in. */
export const INLINE_EDITOR_ATTRIBUTE = "data-val-inline-editor";
/** On the page's own element, hidden while its copy is typed in. */
export const INLINE_ORIGINAL_ATTRIBUTE = "data-val-inline-original";
/** On each element of a richtext copy: which node of the document it is. */
const NODE_ATTRIBUTE = "data-val-inline-node";
/** On a `<br>` put in an empty block so the caret has somewhere to be. */
const FILLER_ATTRIBUTE = "data-val-inline-filler";

/**
 * How long the copy waits for the page's element to show what was typed
 * before giving way to it regardless. Content the SERVER rendered only moves
 * after a round trip, which can take longer than this: then the old text
 * shows for a moment before the page re-renders.
 */
export const INLINE_EDIT_SETTLE_MS = 2000;

const TEXT_BLOCKS: ReadonlySet<string> = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const HEADINGS: ReadonlySet<string> = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const LISTS: ReadonlySet<string> = new Set(["ul", "ol"]);
const INLINE: ReadonlySet<string> = new Set(["span", "a"]);
const LEAVES: ReadonlySet<string> = new Set(["br", "img"]);
/**
 * Every tag this can edit around. A document holding any other (a
 * `blockquote`, a `details`, a `button`) is left to the Studio's own editor,
 * which knows what they are.
 */
const KNOWN_TAGS: ReadonlySet<string> = new Set([
  ...TEXT_BLOCKS,
  ...LISTS,
  "li",
  ...INLINE,
  ...LEAVES,
]);

/** Elements whose text is not theirs to type in. */
const NOT_EDITABLE_TAGS: ReadonlySet<string> = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "IMG",
  "VIDEO",
  "AUDIO",
  "SOURCE",
  "IFRAME",
  "CANVAS",
  "SVG",
]);

/** Whether a value is a richtext document: what `editInline` may carry. */
export function isInlineRichText(
  value: unknown,
): value is InlineRichTextNode[] {
  return Array.isArray(value) && value.every(isInlineRichTextNode);
}

function isInlineRichTextNode(value: unknown): value is InlineRichTextNode {
  if (typeof value === "string") return true;
  if (typeof value !== "object" || value === null) return false;
  const tag: unknown = Reflect.get(value, "tag");
  const children: unknown = Reflect.get(value, "children");
  return (
    typeof tag === "string" &&
    (children === undefined || isInlineRichText(children))
  );
}

/** Whether a value is a candidate: what `editInline` may carry. */
export function isInlineEditCandidate(
  value: unknown,
): value is InlineEditCandidate {
  if (typeof value !== "object" || value === null) return false;
  const path: unknown = Reflect.get(value, "path");
  const kind: unknown = Reflect.get(value, "kind");
  const held: unknown = Reflect.get(value, "value");
  const multiline: unknown = Reflect.get(value, "multiline");
  if (typeof path !== "string") return false;
  if (kind === "string") {
    return (
      typeof held === "string" &&
      (multiline === undefined || typeof multiline === "boolean")
    );
  }
  return kind === "richtext" && isInlineRichText(held);
}

/** Whether a value is a selection: what `applyInlineEdit` may carry. */
export function isInlineSelection(value: unknown): value is InlineSelection {
  if (typeof value !== "object" || value === null) return false;
  return (
    isInlinePoint(Reflect.get(value, "anchor")) &&
    isInlinePoint(Reflect.get(value, "head"))
  );
}

function isInlinePoint(value: unknown): value is InlinePoint {
  if (typeof value !== "object" || value === null) return false;
  const block: unknown = Reflect.get(value, "block");
  const offset: unknown = Reflect.get(value, "offset");
  return (
    typeof block === "number" &&
    Number.isInteger(block) &&
    block >= 0 &&
    typeof offset === "number" &&
    Number.isInteger(offset) &&
    offset >= 0
  );
}

/** Whether a value is what an edit reports: a string, or a document. */
export function isInlineEditValue(value: unknown): value is InlineEditValue {
  return typeof value === "string" || isInlineRichText(value);
}

/**
 * Whether `element` shows `candidate` and nothing else, so that typing in
 * (a copy of) it is typing the field.
 */
export function canEditInline(
  element: Element,
  candidate: InlineEditCandidate,
): boolean {
  if (!isHtmlElement(element)) return false;
  if (NOT_EDITABLE_TAGS.has(element.tagName.toUpperCase())) return false;
  // Not on the page at all: `display: none`, or inside something that is.
  if (
    typeof element.getClientRects === "function" &&
    element.getClientRects().length === 0
  ) {
    return false;
  }
  if (candidate.kind === "string") {
    return (
      element.children.length === 0 && element.textContent === candidate.value
    );
  }
  return (
    candidate.value.every(isKnownNode) &&
    mirrors(element, candidate.value, () => undefined)
  );
}

/**
 * Start editing `candidate` where `element` shows it, or `null` when the
 * element does not show it in a way that can be typed in
 * ({@link canEditInline}).
 */
export function startInlineEditing(
  element: Element,
  candidate: InlineEditCandidate,
  options: {
    /**
     * Where the click that asked for this was, in the viewport: the caret
     * goes there. Absent, it goes to the end.
     */
    at?: { x: number; y: number } | null;
    /**
     * The outline's colour: the Studio's selection colour. Set as a style
     * property, which takes a colour or nothing, so it needs no checking
     * here.
     */
    color: string;
    /** Something was typed: the field's new value, whole. */
    onChange: (value: InlineEditValue) => void;
    /** Editing ended, however it did. Called once. */
    onEnd: () => void;
    /**
     * The selection moved, or the copy did: what the Studio's controls act
     * on, and where to draw them and the field's validation errors. For a
     * string the selection is always `null`: there are no controls for
     * one, but its errors are drawn by it all the same.
     */
    onSelection?: (
      selection: InlineSelection | null,
      rect: InlineRect,
      /** The caret itself, where the browser can say: to keep off it. */
      caret: InlineRect | null,
    ) => void;
    /** {@link INLINE_EDIT_SETTLE_MS}, for a test that will not wait. */
    settleMs?: number;
  },
): InlineEditing | null {
  if (!isHtmlElement(element) || !canEditInline(element, candidate)) {
    return null;
  }
  const original = element;
  const doc = original.ownerDocument;
  const parent = original.parentNode;
  if (parent === null) return null;

  const copy = original.cloneNode(true);
  if (!isHtmlElement(copy)) return null;

  /** The richtext document's nodes, by the index their elements carry. */
  const nodes: InlineRichTextElement[] = [];
  const annotate = (el: Element, node: InlineRichTextElement) => {
    el.setAttribute(NODE_ATTRIBUTE, String(nodes.length));
    nodes.push(node);
  };
  if (candidate.kind === "richtext") {
    mirrors(copy, candidate.value, annotate);
  }

  // --- The copy, in the original's place ---------------------------------
  copy.setAttribute(INLINE_EDITOR_ATTRIBUTE, "");
  copy.style.setProperty("outline-style", "solid", "important");
  copy.style.setProperty("outline-width", "2px", "important");
  copy.style.setProperty("outline-color", options.color, "important");
  copy.style.setProperty("outline-offset", "2px", "important");
  copy.style.setProperty("cursor", "text", "important");
  // What a link or a button would otherwise do with a drag or a selection.
  copy.style.setProperty("user-select", "text", "important");
  copy.style.setProperty("-webkit-user-select", "text", "important");
  copy.setAttribute("draggable", "false");
  copy.setAttribute("spellcheck", "false");
  // Plain text: the browser never invents markup of its own, so whatever is
  // in the copy is a node this put there or one the document had.
  const plainTextOnly = makeEditable(copy);

  const hadHidden = original.hasAttribute("hidden");
  const displayBefore = original.style.getPropertyValue("display");
  const displayPriorityBefore = original.style.getPropertyPriority("display");
  // Before the original when it is a first child, after it otherwise: the
  // copy then answers `:first-child` (or `:last-child`) as the original
  // did, which is what a `prose`-like stylesheet sets its margins by.
  if (original.previousElementSibling === null) {
    parent.insertBefore(copy, original);
  } else {
    parent.insertBefore(copy, original.nextSibling);
  }
  // Both: `hidden` is what sibling selectors that skip hidden elements look
  // at, and the style is what holds when the page's CSS sets a `display`
  // of its own on the element, which beats the attribute.
  original.setAttribute("hidden", "");
  original.setAttribute(INLINE_ORIGINAL_ATTRIBUTE, "");
  original.style.setProperty("display", "none", "important");

  let ended = false;
  let finished = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let settleObserver: MutationObserver | null = null;

  /** Take the copy away and give the page its element back. */
  const finish = () => {
    if (finished) return;
    finished = true;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleObserver?.disconnect();
    presence.disconnect();
    pageObserver.disconnect();
    copy.remove();
    if (!hadHidden) original.removeAttribute("hidden");
    original.removeAttribute(INLINE_ORIGINAL_ATTRIBUTE);
    if (displayBefore === "") {
      original.style.removeProperty("display");
    } else {
      original.style.setProperty(
        "display",
        displayBefore,
        displayPriorityBefore,
      );
    }
    if (original.getAttribute("style") === "") {
      original.removeAttribute("style");
    }
  };

  // --- Reading the copy back ---------------------------------------------
  const read = (): InlineEditValue =>
    candidate.kind === "string"
      ? (copy.textContent ?? "")
      : readRichText(copy, nodes);
  let lastReported = JSON.stringify(candidate.value);
  const report = () => {
    if (ended) return;
    const value = read();
    const serialized = JSON.stringify(value);
    if (serialized === lastReported) return;
    lastReported = serialized;
    options.onChange(value);
    // What was typed can have made the copy taller, or moved the caret
    // without the browser saying so.
    scheduleSelection();
  };

  const stop = () => {
    if (ended) return;
    ended = true;
    copy.removeEventListener("beforeinput", onBeforeInput);
    copy.removeEventListener("input", report);
    copy.removeEventListener("keydown", onKeyDown);
    copy.removeEventListener("keyup", stopPropagation);
    copy.removeEventListener("keypress", stopPropagation);
    copy.removeEventListener("paste", onPaste);
    copy.removeEventListener("drop", onDrop);
    copy.removeEventListener("focusout", onFocusOut);
    doc.removeEventListener("pointerdown", onPressElsewhere, true);
    doc.removeEventListener("selectionchange", scheduleSelection);
    view?.removeEventListener("scroll", scheduleSelection, true);
    view?.removeEventListener("resize", scheduleSelection);
    pageObserver.disconnect();
    copy.setAttribute("contenteditable", "false");
    copy.style.removeProperty("outline-style");
    copy.style.removeProperty("outline-width");
    copy.style.removeProperty("outline-color");
    copy.style.removeProperty("outline-offset");
    options.onEnd();
    if (!original.isConnected || !copy.isConnected) {
      finish();
      return;
    }
    // Until the page shows what was typed: its element coming back with the
    // text from before the edit, and then changing, reads as the edit having
    // been lost and found.
    const shown = () => original.textContent === copy.textContent;
    if (shown()) {
      finish();
      return;
    }
    settleObserver = new MutationObserver(() => {
      if (shown()) finish();
    });
    settleObserver.observe(original, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    settleTimer = setTimeout(finish, options.settleMs ?? INLINE_EDIT_SETTLE_MS);
  };

  // The page took its element away (a navigation, a re-render that replaced
  // it), or the copy with it: there is nothing left to edit.
  const presence = new MutationObserver(() => {
    if (original.isConnected && copy.isConnected) return;
    if (!ended) stop();
    finish();
  });
  presence.observe(parent, { childList: true });

  // --- Typing --------------------------------------------------------------
  const selection = () => doc.getSelection();
  const currentRange = (): Range | null => {
    const sel = selection();
    if (sel === null || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    return copy.contains(range.commonAncestorContainer) ? range : null;
  };
  const placeCaret = (node: Node, offset: number) => {
    const sel = selection();
    if (sel === null) return;
    const range = doc.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const insertText = (text: string) => {
    if (text === "") return;
    // `execCommand`, deprecated and still the one way to type as the
    // keyboard does: through the browser's own editing, undo included.
    if (typeof doc.execCommand === "function") {
      if (doc.execCommand("insertText", false, text)) return;
    }
    const range = currentRange();
    if (range === null) return;
    range.deleteContents();
    const node = doc.createTextNode(text);
    range.insertNode(node);
    placeCaret(node, text.length);
  };

  const sourceOf = (el: Element): InlineRichTextElement | null => {
    const index = el.getAttribute(NODE_ATTRIBUTE);
    if (index === null) return null;
    return nodes[Number(index)] ?? null;
  };
  const tagOf = (el: Element): string | null => sourceOf(el)?.tag ?? null;
  /** The paragraph or heading `node` is in. */
  const textBlockOf = (node: Node | null): HTMLElement | null => {
    let at: Node | null = node;
    while (at !== null && at !== copy) {
      if (isHtmlElement(at)) {
        const tag = tagOf(at);
        if (tag !== null && TEXT_BLOCKS.has(tag)) return at;
      }
      at = at.parentNode;
    }
    return null;
  };
  const textBlocks = (): HTMLElement[] =>
    Array.from(copy.querySelectorAll(`[${NODE_ATTRIBUTE}]`)).filter(
      (el): el is HTMLElement => {
        if (!isHtmlElement(el)) return false;
        const tag = tagOf(el);
        return tag !== null && TEXT_BLOCKS.has(tag);
      },
    );
  /** An element for a new paragraph, classed as the document's own are. */
  const paragraphSample: HTMLElement | null = (() => {
    const found = textBlocks().find((el) => tagOf(el) === "p");
    if (found === undefined) return null;
    const shallow = found.cloneNode(false);
    return isHtmlElement(shallow) ? shallow : null;
  })();
  const newParagraph = (): HTMLElement => {
    // The sample's class where there is one. Where there is not: a bare
    // paragraph, which the page's renderer styles once the edit has
    // reached it. Either way a node of its own, never the sample's.
    const sampled = paragraphSample?.cloneNode(false);
    const fresh =
      sampled !== undefined && isHtmlElement(sampled)
        ? sampled
        : doc.createElement("p");
    annotate(fresh, { tag: "p", children: [] });
    return fresh;
  };
  const removeFillers = (el: Element) => {
    el.querySelectorAll(`[${FILLER_ATTRIBUTE}]`).forEach((br) => br.remove());
  };
  /** An empty block has no height and no place for a caret: give it one. */
  const fill = (block: HTMLElement) => {
    removeEmptyInline(block);
    if (block.textContent === "" && block.querySelector("img, br") === null) {
      const filler = doc.createElement("br");
      filler.setAttribute(FILLER_ATTRIBUTE, "");
      block.appendChild(filler);
    }
  };
  /** Marks and links with nothing left in them. */
  const removeEmptyInline = (block: Element) => {
    Array.from(block.querySelectorAll(`[${NODE_ATTRIBUTE}]`))
      .reverse()
      .forEach((el) => {
        const tag = tagOf(el);
        if (
          tag !== null &&
          INLINE.has(tag) &&
          el.textContent === "" &&
          el.querySelector("img") === null
        ) {
          el.remove();
        }
      });
  };
  /** Take `el` out, and every list item or list it leaves empty. */
  const removeUpwards = (el: Element) => {
    let at: Element | null = el;
    while (at !== null && at !== copy) {
      const up: Element | null = at.parentElement;
      at.remove();
      if (up === null || up === copy) return;
      const tag = tagOf(up);
      const emptied =
        tag !== null &&
        (tag === "li" || LISTS.has(tag)) &&
        up.querySelector(`[${NODE_ATTRIBUTE}]`) === null &&
        up.textContent === "";
      if (!emptied) return;
      at = up;
    }
  };

  /**
   * Delete what `range` holds, and where it began in one block and ended in
   * another, join the two: what is left of the second goes onto the end of
   * the first, marks and all.
   *
   * By hand because the browser's own join, in a plain-text editor, moves
   * the second block's TEXT and leaves its marks and links behind.
   */
  const deleteRange = (range: Range) => {
    const startBlock = textBlockOf(range.startContainer);
    const endBlock = textBlockOf(range.endContainer);
    range.deleteContents();
    if (
      startBlock !== null &&
      endBlock !== null &&
      startBlock !== endBlock &&
      endBlock.isConnected
    ) {
      removeFillers(startBlock);
      removeFillers(endBlock);
      // Where the two meet, which is where the caret belongs.
      const at = startBlock.childNodes.length;
      while (endBlock.firstChild !== null) {
        startBlock.appendChild(endBlock.firstChild);
      }
      removeUpwards(endBlock);
      fill(startBlock);
      placeCaret(startBlock, Math.min(at, startBlock.childNodes.length));
    } else {
      const block = startBlock ?? endBlock;
      if (block !== null && block.isConnected) fill(block);
      range.collapse(true);
      const sel = selection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // Everything was selected and went: a document is never without a block
    // to type in.
    if (textBlocks().length === 0) {
      const fresh = newParagraph();
      copy.appendChild(fresh);
      fill(fresh);
      placeCaret(fresh, 0);
    }
  };

  /** Whether nothing is between the start of `block` and the caret. */
  const atStartOf = (block: HTMLElement, range: Range): boolean => {
    const before = doc.createRange();
    before.setStart(block, 0);
    before.setEnd(range.startContainer, range.startOffset);
    return isBlank(before);
  };
  const atEndOf = (block: HTMLElement, range: Range): boolean => {
    const after = doc.createRange();
    after.setStart(range.endContainer, range.endOffset);
    after.setEnd(block, block.childNodes.length);
    return isBlank(after);
  };
  const isBlank = (range: Range): boolean => {
    const held = range.cloneContents();
    return (
      held.textContent === "" &&
      held.querySelector(`img, br:not([${FILLER_ATTRIBUTE}])`) === null
    );
  };

  /** Enter: the paragraph, heading or list item becomes two at the caret. */
  const splitBlock = () => {
    let range = currentRange();
    if (range === null) return;
    if (!range.collapsed) {
      deleteRange(range);
      range = currentRange();
      if (range === null) return;
    }
    const block = textBlockOf(range.startContainer);
    if (block === null) return;
    const item = block.parentElement;
    // In a list item's first paragraph, Enter is a new ITEM.
    const unit =
      item !== null &&
      item !== copy &&
      tagOf(item) === "li" &&
      item.firstElementChild === block
        ? item
        : block;
    const endOfHeading =
      unit === block &&
      HEADINGS.has(tagOf(block) ?? "") &&
      atEndOf(block, range);
    removeFillers(unit);
    const tail = doc.createRange();
    tail.setStart(range.startContainer, range.startOffset);
    tail.setEnd(unit, unit.childNodes.length);
    const rest = tail.extractContents();
    // What follows a heading is a paragraph, not a second heading.
    const shallow = endOfHeading ? newParagraph() : unit.cloneNode(false);
    if (!isHtmlElement(shallow)) return;
    if (!endOfHeading) shallow.appendChild(rest);
    unit.parentNode?.insertBefore(shallow, unit.nextSibling);
    const blocksOf = (el: HTMLElement): HTMLElement[] =>
      textBlockOf(el) === el
        ? [el]
        : textBlocks().filter((candidate) => el.contains(candidate));
    blocksOf(unit).forEach(fill);
    const fresh = blocksOf(shallow);
    fresh.forEach(fill);
    const first = fresh[0];
    if (first !== undefined) placeCaret(first, 0);
  };

  // --- Where the caret is, for the Studio's controls -----------------------
  /** A place in the copy, as a place in the document. */
  const pointOf = (node: Node | null, offset: number): InlinePoint | null => {
    const block = textBlockOf(node);
    if (block === null || node === null) return null;
    const index = textBlocks().indexOf(block);
    if (index < 0) return null;
    const before = doc.createRange();
    before.setStart(block, 0);
    before.setEnd(node, offset);
    const held = before.cloneContents();
    let leaves = 0;
    held.querySelectorAll(`[${NODE_ATTRIBUTE}]`).forEach((el) => {
      if (LEAVES.has(tagOf(el) ?? "")) leaves += 1;
    });
    return { block: index, offset: (held.textContent ?? "").length + leaves };
  };
  /** And back: a place in the document, as a place in the copy. */
  const placeOf = (
    point: InlinePoint,
  ): { node: Node; offset: number } | null => {
    const block = textBlocks()[point.block];
    if (block === undefined) return null;
    let left = point.offset;
    const within = (parent: Node): { node: Node; offset: number } | null => {
      for (let index = 0; index < parent.childNodes.length; index++) {
        const child = parent.childNodes[index];
        if (child.nodeType === 3) {
          const length = (child.nodeValue ?? "").length;
          if (left <= length) return { node: child, offset: left };
          left -= length;
        } else if (isElement(child) && !child.hasAttribute(FILLER_ATTRIBUTE)) {
          if (LEAVES.has(tagOf(child) ?? "")) {
            if (left === 0) return { node: parent, offset: index };
            left -= 1;
          } else {
            const found = within(child);
            if (found !== null) return found;
          }
        }
      }
      return null;
    };
    const found = within(block);
    if (found !== null) return found;
    // Past the end, or in a block with nothing in it: its end, before the
    // filler that holds it open.
    const last = block.lastChild;
    const hasFiller =
      last !== null && isElement(last) && last.hasAttribute(FILLER_ATTRIBUTE);
    return {
      node: block,
      offset: block.childNodes.length - (hasFiller ? 1 : 0),
    };
  };
  const selected = (): InlineSelection | null => {
    const sel = selection();
    if (sel === null || sel.rangeCount === 0) return null;
    if (!copy.contains(sel.anchorNode) || !copy.contains(sel.focusNode)) {
      return null;
    }
    const anchor = pointOf(sel.anchorNode, sel.anchorOffset);
    const head = pointOf(sel.focusNode, sel.focusOffset);
    return anchor !== null && head !== null ? { anchor, head } : null;
  };
  const select = (wanted: InlineSelection | null) => {
    const sel = selection();
    if (sel === null || wanted === null) return;
    const anchor = placeOf(wanted.anchor);
    const head = placeOf(wanted.head);
    if (anchor === null || head === null) return;
    sel.setBaseAndExtent(anchor.node, anchor.offset, head.node, head.offset);
  };

  const view = doc.defaultView;
  let selectionTimer: number | null = null;
  let lastSelection = "";
  /** The last selection there was in the copy: where the caret goes back to. */
  let keptSelection: InlineSelection | null = null;
  const reportSelection = () => {
    selectionTimer = null;
    if (ended || options.onSelection === undefined) return;
    const box = copy.getBoundingClientRect();
    const rect: InlineRect = {
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
    };
    const now = selected();
    // No selection while the focus is elsewhere is not a selection of
    // nothing: a control the focus went to still acts on the last one.
    if (now === null && !copy.contains(doc.activeElement)) return;
    keptSelection = now ?? keptSelection;
    const sel = selection();
    const range =
      now !== null && sel !== null && sel.rangeCount > 0
        ? sel.getRangeAt(0)
        : null;
    const at =
      range !== null && typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : null;
    // A caret in an empty line has no box of its own to report.
    const caret: InlineRect | null =
      at !== null && (at.width > 0 || at.height > 0)
        ? { top: at.top, left: at.left, width: at.width, height: at.height }
        : null;
    const serialized = JSON.stringify([now, rect, caret]);
    if (serialized === lastSelection) return;
    lastSelection = serialized;
    options.onSelection(now, rect, caret);
  };
  /*
   * A turn later, and once however many times it was asked for in that
   * turn: a keystroke moves the selection, changes the text and can move
   * the copy, and the Studio is told once, after it has the text.
   */
  const scheduleSelection = () => {
    if (options.onSelection === undefined) return;
    if (selectionTimer !== null || ended || view === null) return;
    selectionTimer = view.setTimeout(reportSelection, 0);
  };

  // --- What one of the Studio's controls made of the document --------------
  /**
   * An element of each kind of node the document has had, to class a new
   * one by: the page's theme gives a bold word its class, and the only
   * place this can read that is a bold word the page already rendered.
   */
  const samples = new Map<string, Element>();
  const stylesOf = (node: InlineRichTextElement): string[] => {
    const styles: unknown = node.styles;
    return Array.isArray(styles)
      ? styles
          .filter((style): style is string => typeof style === "string")
          .sort()
      : [];
  };
  const kindOf = (node: InlineRichTextElement): string =>
    node.tag === "span" ? `span ${stylesOf(node).join(" ")}` : node.tag;
  const gatherSamples = () => {
    copy.querySelectorAll(`[${NODE_ATTRIBUTE}]`).forEach((el) => {
      const source = sourceOf(el);
      if (source !== null) samples.set(kindOf(source), el);
    });
  };
  const build = (
    children: readonly InlineRichTextNode[],
    into: Node,
    images: Map<string, Element[]>,
  ) => {
    for (const child of children) {
      if (typeof child === "string") {
        into.appendChild(doc.createTextNode(child));
        continue;
      }
      if (!KNOWN_TAGS.has(child.tag)) continue;
      // An image is the one the document had: nothing here can make one.
      const image =
        child.tag === "img"
          ? images.get(JSON.stringify(child))?.shift()
          : undefined;
      const sample = samples.get(kindOf(child));
      const made =
        image?.cloneNode(true) ??
        sample?.cloneNode(false) ??
        doc.createElement(child.tag);
      if (!isHtmlElement(made)) continue;
      if (sample === undefined && child.tag === "span") {
        // No word of this kind on the page yet to take the class of: shown
        // as what it is until the page's own rendering arrives.
        const styles = stylesOf(child);
        if (styles.includes("bold")) made.style.fontWeight = "bold";
        if (styles.includes("italic")) made.style.fontStyle = "italic";
        if (styles.includes("line-through")) {
          made.style.textDecoration = "line-through";
        }
      }
      if (child.tag === "a") {
        if (typeof child.href === "string") {
          made.setAttribute("href", child.href);
        } else {
          made.removeAttribute("href");
        }
      }
      annotate(made, child);
      into.appendChild(made);
      if (!LEAVES.has(child.tag)) build(child.children ?? [], made, images);
    }
  };
  /** Whether the page's own element has yet to show what was applied. */
  let awaitingPage = false;
  /**
   * The copy, drawn again from the page's own element, once that shows the
   * very document the copy holds: every class is then the page's, where
   * `apply` could only guess at one it had no example of.
   *
   * Only then. While they differ -- more was typed since, or the page has
   * not rendered yet -- the copy is what the person is looking at, and it
   * stays.
   */
  const refresh = () => {
    if (ended || !awaitingPage || candidate.kind !== "richtext") return;
    const value = readRichText(copy, nodes);
    if (!mirrors(original, value, () => undefined)) return;
    awaitingPage = false;
    const kept = selected();
    copy.replaceChildren(
      ...Array.from(original.childNodes, (child) => child.cloneNode(true)),
    );
    nodes.length = 0;
    mirrors(copy, value, annotate);
    textBlocks().forEach(fill);
    select(kept);
    scheduleSelection();
  };
  const apply = (
    value: InlineRichTextNode[],
    wanted: InlineSelection | null,
  ) => {
    if (ended || candidate.kind !== "richtext") return;
    if (!value.every(isKnownNode)) return;
    gatherSamples();
    const images = new Map<string, Element[]>();
    copy.querySelectorAll(`[${NODE_ATTRIBUTE}]`).forEach((el) => {
      const source = sourceOf(el);
      if (source === null || source.tag !== "img") return;
      const key = JSON.stringify(source);
      images.set(key, [...(images.get(key) ?? []), el]);
    });
    nodes.length = 0;
    const built = doc.createDocumentFragment();
    build(value, built, images);
    copy.replaceChildren(built);
    if (textBlocks().length === 0) copy.appendChild(newParagraph());
    textBlocks().forEach(fill);
    copy.focus({ preventScroll: true });
    select(wanted);
    keptSelection = wanted ?? keptSelection;
    // The Studio made this value, so it is not news to it -- unless the
    // copy could not hold it as given, which it is then told.
    lastReported = JSON.stringify(value);
    report();
    awaitingPage = true;
    refresh();
    scheduleSelection();
  };
  const pageObserver = new MutationObserver(refresh);
  pageObserver.observe(original, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });

  const onBeforeInput = (event: InputEvent) => {
    const type = event.inputType;
    if (type.startsWith("format")) {
      // A mark's class is the page's theme's to give: see the file's note.
      event.preventDefault();
      return;
    }
    const isBreak = type === "insertParagraph" || type === "insertLineBreak";
    if (candidate.kind === "string") {
      if (!isBreak) return;
      if (candidate.multiline !== true) {
        event.preventDefault();
        stop();
        return;
      }
      if (!plainTextOnly) {
        // A rich editor's Enter is a new `<div>`; a string's is a new line.
        event.preventDefault();
        insertText("\n");
      }
      return;
    }
    if (isBreak) {
      event.preventDefault();
      splitBlock();
      report();
      return;
    }
    if (type.startsWith("history") || type === "insertCompositionText") return;
    const range = currentRange();
    if (range === null) return;
    if (!range.collapsed) {
      const startBlock = textBlockOf(range.startContainer);
      const endBlock = textBlockOf(range.endContainer);
      // Inside one block the browser's own editing keeps what is around it.
      if (startBlock !== null && startBlock === endBlock) return;
      event.preventDefault();
      deleteRange(range);
      if (type.startsWith("insert") && typeof event.data === "string") {
        insertText(singleLine(event.data));
      }
      report();
      return;
    }
    if (!type.startsWith("delete")) return;
    const block = textBlockOf(range.startContainer);
    if (block === null) return;
    const blocks = textBlocks();
    const index = blocks.indexOf(block);
    if (type.endsWith("Backward") && atStartOf(block, range)) {
      event.preventDefault();
      const previous = blocks[index - 1];
      if (previous === undefined) return;
      removeFillers(previous);
      const join = doc.createRange();
      join.setStart(previous, previous.childNodes.length);
      join.setEnd(range.startContainer, range.startOffset);
      deleteRange(join);
      report();
      return;
    }
    if (type.endsWith("Forward") && atEndOf(block, range)) {
      event.preventDefault();
      const next = blocks[index + 1];
      if (next === undefined) return;
      removeFillers(block);
      const join = doc.createRange();
      join.setStart(block, block.childNodes.length);
      join.setEnd(next, 0);
      deleteRange(join);
      report();
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // The page's own shortcuts are for a page that is being used, not one
    // being typed in: `/` opening its search mid-sentence is not an edit.
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      stop();
      return;
    }
    if (
      event.key === "Enter" &&
      candidate.kind === "string" &&
      candidate.multiline !== true
    ) {
      event.preventDefault();
      stop();
    }
  };

  const onPaste = (event: ClipboardEvent) => {
    // As text, whatever was copied: markup from another page is not this
    // document's, and in a single line neither is a line break.
    event.preventDefault();
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    const text =
      candidate.kind === "string" && candidate.multiline === true
        ? pasted.replace(/\r\n?/g, "\n")
        : singleLine(pasted);
    if (candidate.kind === "richtext") {
      const range = currentRange();
      if (range !== null && !range.collapsed) {
        const startBlock = textBlockOf(range.startContainer);
        if (
          startBlock === null ||
          startBlock !== textBlockOf(range.endContainer)
        ) {
          deleteRange(range);
        }
      }
    }
    insertText(text);
    report();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
  };

  const onFocusOut = (event: FocusEvent) => {
    const to = event.relatedTarget;
    // To something else on the page: the edit is over.
    if (isNode(to) && !copy.contains(to)) stop();
    /*
     * To nothing the page can name, it is not: the focus has left the page
     * for the Studio around it, or for another window. The Studio's own
     * controls for this text are out there, and pressing one must not take
     * away what it acts on. What a press elsewhere in the Studio means is
     * the Studio's to say (`stopInlineEdit`), and a press elsewhere on the
     * page is heard below.
     *
     * Not `document.hasFocus()`, which would seem to be the question: for a
     * document in a frame it goes on answering yes after the focus has
     * gone to the document around it, wherever focus is emulated.
     */
  };
  /** A press on the page, outside the text: the edit is over. */
  const onPressElsewhere = (event: Event) => {
    const target = event.target;
    if (isNode(target) && copy.contains(target)) return;
    stop();
  };

  copy.addEventListener("beforeinput", onBeforeInput);
  copy.addEventListener("input", report);
  copy.addEventListener("keydown", onKeyDown);
  copy.addEventListener("keyup", stopPropagation);
  copy.addEventListener("keypress", stopPropagation);
  copy.addEventListener("paste", onPaste);
  copy.addEventListener("drop", onDrop);
  copy.addEventListener("focusout", onFocusOut);
  doc.addEventListener("pointerdown", onPressElsewhere, true);
  if (options.onSelection !== undefined) {
    doc.addEventListener("selectionchange", scheduleSelection);
    // Capturing: a scroll of anything the copy is inside moves it.
    view?.addEventListener("scroll", scheduleSelection, true);
    view?.addEventListener("resize", scheduleSelection);
  }

  if (candidate.kind === "richtext") textBlocks().forEach(fill);

  // --- The caret, where the click was --------------------------------------
  copy.focus({ preventScroll: true });
  const at = options.at ?? null;
  const clicked = at === null ? null : caretFromPoint(doc, at.x, at.y);
  if (clicked !== null && copy.contains(clicked.node)) {
    placeCaret(clicked.node, clicked.offset);
  } else {
    const last =
      candidate.kind === "richtext" ? textBlocks().slice(-1)[0] : undefined;
    const end = last ?? copy;
    removeFillers(end);
    placeCaret(end, end.childNodes.length);
    if (last !== undefined) fill(last);
  }
  scheduleSelection();

  return {
    path: candidate.path,
    isActive: () => !ended,
    contains: (node) => node !== null && copy.contains(node),
    stop,
    release: () => {
      stop();
      finish();
    },
    apply,
    focus: () => {
      if (ended) return;
      copy.focus({ preventScroll: true });
      if (selected() === null) select(keptSelection);
      // The copy can have moved while the focus was away -- the frame made
      // narrower -- and a report is not made without the focus.
      scheduleSelection();
    },
  };
}

/**
 * Whether `element`'s children are `children`, tag for tag and text for
 * text, calling `visit` for each element with the node it is.
 *
 * Elements are compared in order and text as a whole per parent, not text
 * node by text node: a renderer may give one string two text nodes or two
 * strings one, and neither changes what is on the page.
 */
function mirrors(
  element: Element,
  children: readonly InlineRichTextNode[],
  visit: (el: Element, node: InlineRichTextElement) => void,
): boolean {
  const elements = Array.from(element.children);
  const nodes = children.filter(
    (child): child is InlineRichTextElement => typeof child !== "string",
  );
  if (elements.length !== nodes.length) return false;
  const text = children
    .filter((child): child is string => typeof child === "string")
    .join("");
  if (directText(element) !== text) return false;
  return nodes.every((node, index) => {
    const el = elements[index];
    if (el.tagName.toLowerCase() !== node.tag) return false;
    visit(el, node);
    if (LEAVES.has(node.tag)) return true;
    return mirrors(el, node.children ?? [], visit);
  });
}

function directText(element: Element): string {
  let text = "";
  element.childNodes.forEach((child) => {
    if (child.nodeType === 3) text += child.nodeValue ?? "";
  });
  return text;
}

function isKnownNode(node: InlineRichTextNode): boolean {
  if (typeof node === "string") return true;
  return KNOWN_TAGS.has(node.tag) && (node.children ?? []).every(isKnownNode);
}

/**
 * The document a richtext copy holds now.
 *
 * Every element is either one the document had -- it carries its node's
 * index, and keeps everything about that node but its children, which are
 * read afresh -- or one the browser put there, which is read through to
 * what it holds.
 */
function readRichText(
  root: Element,
  nodes: readonly InlineRichTextElement[],
): InlineRichTextNode[] {
  const sourceOf = (el: Element): InlineRichTextElement | null => {
    const index = el.getAttribute(NODE_ATTRIBUTE);
    return index === null ? null : (nodes[Number(index)] ?? null);
  };

  /** What a paragraph, heading, link or mark holds. */
  const inline = (el: Element): InlineRichTextNode[] => {
    const out: InlineRichTextNode[] = [];
    const push = (node: InlineRichTextNode) => {
      const last = out[out.length - 1];
      if (typeof node === "string") {
        if (node === "") return;
        if (typeof last === "string") {
          out[out.length - 1] = last + node;
          return;
        }
      }
      out.push(node);
    };
    el.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        // A line break typed or pasted into a block is a space: a new
        // paragraph is what Enter makes, and it is made as one.
        push(singleLine(child.nodeValue ?? ""));
        return;
      }
      if (!isElement(child)) return;
      const source = sourceOf(child);
      if (source === null) {
        // The browser's own: a filler `<br>`, a wrapper it added.
        if (child.tagName !== "BR") inline(child).forEach(push);
        return;
      }
      if (LEAVES.has(source.tag)) {
        push(source);
        return;
      }
      if (source.tag === "span") {
        // A mark holds one string, by the document's own rule.
        const text = singleLine(child.textContent ?? "");
        if (text !== "") push({ ...source, children: [text] });
        return;
      }
      if (source.tag === "a") {
        const held = inline(child);
        if (held.length > 0) push({ ...source, children: held });
        return;
      }
      // A block inside a block, which only a browser's join leaves: its
      // words belong to the block it ended up in.
      inline(child).forEach(push);
    });
    return out;
  };

  /** What the document, or a list item, holds: blocks. */
  const blocks = (el: Element): InlineRichTextNode[] => {
    const out: InlineRichTextNode[] = [];
    /** Words outside any block, gathered into a paragraph of their own. */
    let loose: InlineRichTextNode[] = [];
    const flush = () => {
      const held = loose.filter(
        (node) => typeof node !== "string" || node.trim() !== "",
      );
      if (held.length > 0) out.push({ tag: "p", children: loose });
      loose = [];
    };
    el.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const text = singleLine(child.nodeValue ?? "");
        if (text !== "") loose.push(text);
        return;
      }
      if (!isElement(child)) return;
      const source = sourceOf(child);
      if (source === null) {
        if (child.tagName !== "BR") loose.push(...inline(child));
        return;
      }
      if (TEXT_BLOCKS.has(source.tag)) {
        flush();
        out.push({ ...source, children: inline(child) });
        return;
      }
      if (LISTS.has(source.tag)) {
        flush();
        const items = listItems(child);
        if (items.length > 0) out.push({ ...source, children: items });
        return;
      }
      if (source.tag === "li") {
        // An item outside its list: what it holds, as blocks.
        flush();
        out.push(...blocks(child));
        return;
      }
      if (LEAVES.has(source.tag)) {
        loose.push(source);
        return;
      }
      loose.push(...inline(child));
    });
    flush();
    return out;
  };

  const listItems = (el: Element): InlineRichTextNode[] => {
    const out: InlineRichTextNode[] = [];
    Array.from(el.children).forEach((child) => {
      const source = sourceOf(child);
      if (source === null || source.tag !== "li") return;
      const held = blocks(child);
      if (held.length > 0) out.push({ ...source, children: held });
    });
    return out;
  };

  return blocks(root);
}

/** Text with its line breaks, and the spaces around them, as one space. */
function singleLine(text: string): string {
  return text.replace(/[ \t]*[\r\n]+[ \t]*/g, " ");
}

/**
 * Make `el` editable as plain text, and say whether the browser does that
 * itself. Where it does not (`plaintext-only` is newer than some browsers
 * in use), the element is editable as rich text and this file's own
 * handlers keep markup out of it.
 */
function makeEditable(el: HTMLElement): boolean {
  el.setAttribute("contenteditable", "plaintext-only");
  // A browser that does not know the value reads the attribute as absent.
  if (el.contentEditable === "plaintext-only") return true;
  el.setAttribute("contenteditable", "true");
  return false;
}

/** Where in the text a point in the viewport is. */
function caretFromPoint(
  doc: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  const standard: unknown = Reflect.get(doc, "caretPositionFromPoint");
  if (typeof standard === "function") {
    const position: unknown = standard.call(doc, x, y);
    if (typeof position === "object" && position !== null) {
      const node: unknown = Reflect.get(position, "offsetNode");
      const offset: unknown = Reflect.get(position, "offset");
      if (isNode(node) && typeof offset === "number") return { node, offset };
    }
  }
  const legacy: unknown = Reflect.get(doc, "caretRangeFromPoint");
  if (typeof legacy === "function") {
    const range: unknown = legacy.call(doc, x, y);
    if (typeof range === "object" && range !== null) {
      const node: unknown = Reflect.get(range, "startContainer");
      const offset: unknown = Reflect.get(range, "startOffset");
      if (isNode(node) && typeof offset === "number") return { node, offset };
    }
  }
  return null;
}

function stopPropagation(event: Event): void {
  event.stopPropagation();
}

/*
 * By shape rather than `instanceof`: the page is a frame, and a node from
 * another document is not an instance of this window's `Node`.
 */
function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "nodeType") === "number"
  );
}

function isElement(value: Node): value is Element {
  return value.nodeType === 1;
}

function isHtmlElement(value: Node): value is HTMLElement {
  return (
    value.nodeType === 1 &&
    typeof Reflect.get(value, "style") === "object" &&
    typeof Reflect.get(value, "focus") === "function" &&
    Reflect.get(value, "namespaceURI") === "http://www.w3.org/1999/xhtml"
  );
}
