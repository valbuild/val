import { INLINE_EDITOR_ATTRIBUTE } from "./inlineEditing";

/**
 * The keys pressed between a click on a text and the caret going into it.
 *
 * Most clicks start the edit in the click itself, because the Studio has told
 * the page beforehand which of its elements are texts and what they hold
 * (`textFields` in the canvas protocol). This is for the rest: a text whose
 * value changed since the Studio last said, so the page cannot tell on its own
 * that the element shows it and asks (`clicked`, then `editInline`). That
 * round trip takes long enough -- a few hundred milliseconds in development --
 * for the first letters of a word typed straight after the click to land on
 * the page's body, which drops them, and for an `End` to be lost so that what
 * follows goes in at the click.
 *
 * So they are held, and nothing else hears them: neither the page's own
 * shortcuts nor the browser, so nothing is scrolled or typed where the caret
 * is not. When the edit starts they are replayed into it
 * ({@link replayKeys}); when the Studio opens the field in its column instead,
 * they are dropped, which is what a key pressed on a page that is not being
 * typed in does anyway.
 *
 * Not held: Escape (Select's own way out, heard by the bridge), a modifier on
 * its own, and anything mid-composition, which belongs to an input method this
 * cannot replay.
 */
export type HeldKey = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

export type HeldKeys = {
  /** Stop holding, and hand over what was held, in the order pressed. */
  release(): HeldKey[];
};

const MODIFIERS: ReadonlySet<string> = new Set([
  "Shift",
  "Control",
  "Meta",
  "Alt",
  "AltGraph",
  "CapsLock",
  "Fn",
  "OS",
]);

/**
 * How long keys are held at most. The Studio answers every pick it asks the
 * page about, so this is only for an answer that never comes (a Studio that
 * went away mid-pick): the page's keyboard is not taken for longer.
 */
export const HOLD_KEYS_MS = 2000;

/** Hold the keys pressed in `view` from now until {@link HeldKeys.release}. */
export function holdKeys(
  view: Window,
  options: { timeoutMs?: number } = {},
): HeldKeys {
  const held: HeldKey[] = [];
  let holding = true;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.key === "Process") return;
    if (event.key === "Escape" || MODIFIERS.has(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    held.push({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
    });
  };
  const stop = () => {
    if (!holding) return;
    holding = false;
    clearTimeout(timer);
    view.removeEventListener("keydown", onKeyDown, true);
  };
  view.addEventListener("keydown", onKeyDown, true);
  // Dropped, not replayed: by then nobody is waiting for them.
  const timer = setTimeout(() => {
    stop();
    held.length = 0;
  }, options.timeoutMs ?? HOLD_KEYS_MS);
  return {
    release: () => {
      stop();
      return held.splice(0);
    },
  };
}

/**
 * Press `keys` again, in the text being typed in on the page: what the
 * keyboard would have done had the caret been there when they were pressed.
 *
 * A synthetic key event types nothing -- the browser does no default action
 * for an event a script made -- so each key goes through the same two events
 * a real one does, and its effect is done here only where nothing handled
 * them:
 *
 * 1. `keydown`, to the copy: what ends a single line (Enter) or the edit
 *    (Escape) is heard there, as for a real key.
 * 2. `beforeinput`, for a key that edits: what joins two blocks of a richtext
 *    (Backspace at the start of one) or splits one (Enter) is handled there,
 *    as for a real key (`inlineEditing.ts`).
 * 3. Otherwise the browser's own editing, through `execCommand` -- which is
 *    what `inlineEditing.ts` types with too -- or the selection's own `modify`
 *    for a key that moves the caret.
 *
 * Tab and shortcuts other than select-all are dropped: they would act on the
 * page or the browser, not on the text. Replay stops when the edit does --
 * an Enter that ended a single line -- and the keys after it are dropped, as
 * they would have gone to a page that is no longer being typed in.
 */
export function replayKeys(doc: Document, keys: readonly HeldKey[]): void {
  for (const key of keys) {
    const copy = doc.activeElement;
    if (copy === null || !isEditing(copy)) return;
    const down = new KeyboardEvent("keydown", {
      key: key.key,
      shiftKey: key.shiftKey,
      ctrlKey: key.ctrlKey,
      metaKey: key.metaKey,
      altKey: key.altKey,
      bubbles: true,
      cancelable: true,
    });
    if (!copy.dispatchEvent(down)) continue;
    const shortcut = key.ctrlKey || key.metaKey;
    if (shortcut && key.key.toLowerCase() === "a") {
      doc.getSelection()?.selectAllChildren(copy);
      continue;
    }
    if (move(doc, key)) continue;
    if (shortcut) continue;
    const input = inputOf(key);
    if (input === null) continue;
    const before = new InputEvent("beforeinput", {
      inputType: input.inputType,
      data: input.data,
      bubbles: true,
      cancelable: true,
    });
    if (!copy.dispatchEvent(before)) continue;
    edit(doc, copy, input);
  }
}

type Input = { inputType: string; data: string | null };

function inputOf(key: HeldKey): Input | null {
  if (key.key === "Backspace") {
    return { inputType: "deleteContentBackward", data: null };
  }
  if (key.key === "Delete") {
    return { inputType: "deleteContentForward", data: null };
  }
  if (key.key === "Enter") {
    return {
      inputType: key.shiftKey ? "insertLineBreak" : "insertParagraph",
      data: null,
    };
  }
  // A key that types one character: its name is that character.
  if (Array.from(key.key).length === 1) {
    return { inputType: "insertText", data: key.key };
  }
  return null;
}

/** A key that moves the caret, moved: true when it was one. */
function move(doc: Document, key: HeldKey): boolean {
  const how = movementOf(key);
  if (how === null) return false;
  const sel = doc.getSelection();
  // Not in every engine's types, nor in jsdom; in every browser this runs in.
  const modify: unknown = sel === null ? undefined : Reflect.get(sel, "modify");
  if (sel !== null && typeof modify === "function") {
    modify.call(
      sel,
      key.shiftKey ? "extend" : "move",
      how.direction,
      how.granularity,
    );
  }
  return true;
}

function movementOf(
  key: HeldKey,
): { direction: "forward" | "backward"; granularity: string } | null {
  const word = key.altKey || key.ctrlKey;
  switch (key.key) {
    case "ArrowLeft":
      return {
        direction: "backward",
        granularity: key.metaKey ? "lineboundary" : word ? "word" : "character",
      };
    case "ArrowRight":
      return {
        direction: "forward",
        granularity: key.metaKey ? "lineboundary" : word ? "word" : "character",
      };
    case "ArrowUp":
      return { direction: "backward", granularity: "line" };
    case "ArrowDown":
      return { direction: "forward", granularity: "line" };
    case "Home":
      return { direction: "backward", granularity: "lineboundary" };
    case "End":
      return { direction: "forward", granularity: "lineboundary" };
    default:
      return null;
  }
}

/** What the browser does for `input` when nothing prevented it. */
function edit(doc: Document, copy: Element, input: Input): void {
  const command =
    input.inputType === "deleteContentBackward"
      ? { name: "delete", value: undefined }
      : input.inputType === "deleteContentForward"
        ? { name: "forwardDelete", value: undefined }
        : // A break nothing handled is a string's own new line: a richtext's
          // and a single line's are always handled.
          {
            name: "insertText",
            value: input.data ?? "\n",
          };
  // `execCommand`, deprecated and still the one way to type as the keyboard
  // does: through the browser's own editing, which fires `input` and keeps
  // undo. Where it is missing (jsdom) or refuses, by hand.
  if (typeof doc.execCommand === "function") {
    if (doc.execCommand(command.name, false, command.value)) return;
  }
  const sel = doc.getSelection();
  if (sel === null || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!copy.contains(range.commonAncestorContainer)) return;
  if (command.name === "insertText") {
    const text = command.value ?? "";
    range.deleteContents();
    const node = doc.createTextNode(text);
    range.insertNode(node);
    range.setStart(node, text.length);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } else if (!range.collapsed) {
    range.deleteContents();
  } else {
    let at = range.startContainer;
    let offset = range.startOffset;
    if (at.nodeType !== 3) {
      // Between two children: into the text beside the caret.
      const beside =
        command.name === "delete"
          ? at.childNodes[offset - 1]
          : at.childNodes[offset];
      if (beside === undefined || beside.nodeType !== 3) return;
      at = beside;
      offset =
        command.name === "delete" ? (beside.textContent?.length ?? 0) : 0;
    }
    const length = at.textContent?.length ?? 0;
    const from = command.name === "delete" ? offset - 1 : offset;
    if (from < 0 || from >= length) return;
    range.setStart(at, from);
    range.setEnd(at, from + 1);
    range.deleteContents();
  }
  copy.dispatchEvent(
    new InputEvent("input", {
      inputType: input.inputType,
      data: input.data,
      bubbles: true,
    }),
  );
}

/** Whether `element` is the copy being typed in, still editable. */
function isEditing(element: Element): boolean {
  if (!element.hasAttribute(INLINE_EDITOR_ATTRIBUTE)) return false;
  const editable = element.getAttribute("contenteditable");
  return editable !== null && editable !== "false";
}
