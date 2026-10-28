/**
 * Looking at a page from the design tab (valbuild/home `docs/design-tab.md`):
 * where it is -- its path and scroll, so a new build opens at the same place
 * -- and what is on it, so the assistant can check its own change
 * (`read_page`).
 *
 * Plain DOM and in `shared` for the reason `elementPicker.ts` is: the canvas
 * bridge (`@valbuild/next`, `@valbuild/tanstack`) runs it inside the
 * proposal's page, which is another origin than the tab and the only place
 * the page can be read. Only what is returned here crosses the frame
 * (`valCanvasProtocol.ts`).
 */

import { VAL_CANVAS_PARAM } from "./valCanvasProtocol";

/** Where the page is: what a new build is opened at. */
export type PageLocation = {
  /** Its path and query, without the canvas's own parameter. */
  path: string;
  scrollX: number;
  scrollY: number;
};

/** A box on the page, in CSS pixels from the top of the document. */
export type PageBox = { x: number; y: number; width: number; height: number };

/** One thing a reader would notice on the page, in document order. */
export type PageOutlineItem = {
  kind: "heading" | "text" | "link" | "button" | "image" | "input" | "section";
  tag: string;
  /** How to find it again: `read_page` with this `selector`. */
  selector: string;
  /** The words in it, shortened. Absent for an image or an empty element. */
  text?: string;
  /** `h1` is 1. */
  level?: number;
  href?: string;
  alt?: string;
  src?: string;
  box: PageBox;
};

/** One element in detail: what `read_page` answers for a `selector`. */
export type PageElementDetail = {
  selector: string;
  tag: string;
  text: string;
  box: PageBox;
  /** How many lines its text wraps to, when it can be told. */
  lines?: number;
  /** The computed styles a change to a design is usually about. */
  styles: Record<string, string>;
  /** Its children, one level down. */
  children: Array<{
    tag: string;
    selector: string;
    text?: string;
    box: PageBox;
  }>;
};

export type PageSnapshot = {
  /** The page's own address. */
  url: string;
  title: string;
  viewport: {
    width: number;
    height: number;
    scrollY: number;
    /** How tall the whole page is. */
    pageHeight: number;
  };
  outline: PageOutlineItem[];
  /** Cut short at `maxItems`: narrow with a `selector`. */
  truncated?: true;
  /** The element asked for by `selector`. */
  element?: PageElementDetail;
  /** The `selector` matched nothing. */
  notFound?: string;
};

const TEXT_LENGTH = 160;
const DEFAULT_MAX_ITEMS = 300;
const MAX_CHILDREN = 40;

/** The computed styles worth reading back: type, colour, spacing, layout. */
const STYLES = [
  "display",
  "position",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "color",
  "background-color",
  "background-image",
  "margin",
  "padding",
  "gap",
  "border",
  "border-radius",
  "box-shadow",
  "width",
  "height",
  "max-width",
  "flex-direction",
  "justify-content",
  "align-items",
  "grid-template-columns",
  "opacity",
  "overflow",
];

/** Where `win` is now. */
export function pageLocationOf(win: Window): PageLocation {
  const url = new URL(win.location.href);
  // The canvas's own parameter is not part of where the page is.
  url.searchParams.delete(VAL_CANVAS_PARAM);
  return {
    path: `${url.pathname}${url.search}${url.hash}`,
    scrollX: Math.round(win.scrollX),
    scrollY: Math.round(win.scrollY),
  };
}

/**
 * Report where the page is as it moves: on scroll, a little after it settles,
 * and when it navigates -- which a client-side router does without an event,
 * so the address is also looked at now and then. Returns the way to stop.
 */
export function watchPageLocation(
  win: Window,
  onChange: (location: PageLocation) => void,
  options?: { settleMs?: number; pollMs?: number },
): () => void {
  const settleMs = options?.settleMs ?? 200;
  const pollMs = options?.pollMs ?? 500;
  let last = "";
  const report = () => {
    const location = pageLocationOf(win);
    const key = JSON.stringify(location);
    if (key === last) return;
    last = key;
    onChange(location);
  };
  let settle: ReturnType<typeof setTimeout> | null = null;
  const onScroll = () => {
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => {
      settle = null;
      report();
    }, settleMs);
  };
  win.addEventListener("scroll", onScroll, { passive: true });
  win.addEventListener("popstate", report);
  const poll = setInterval(report, pollMs);
  report();
  return () => {
    win.removeEventListener("scroll", onScroll);
    win.removeEventListener("popstate", report);
    clearInterval(poll);
    if (settle !== null) clearTimeout(settle);
  };
}

/**
 * Scroll to where the last build was, once the page is tall enough to: a page
 * that is still loading its content is shorter than it will be, so this tries
 * again each frame for a while rather than stopping at the bottom of half a
 * page. Returns the way to stop trying.
 */
export function restoreScroll(
  win: Window,
  x: number,
  y: number,
  options?: { withinMs?: number },
): () => void {
  const until = Date.now() + (options?.withinMs ?? 2000);
  let frame: number | null = null;
  const attempt = () => {
    frame = null;
    win.scrollTo(x, y);
    const reached =
      Math.abs(win.scrollY - y) < 2 && Math.abs(win.scrollX - x) < 2;
    if (!reached && Date.now() < until) {
      frame = win.requestAnimationFrame(attempt);
    }
  };
  attempt();
  return () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
  };
}

/**
 * What is on the page, as a reader would take it in: headings, text, links,
 * buttons, images and inputs, in order, each with where it is. With a
 * `selector`, that element in detail -- its computed styles, how many lines
 * its text wraps to, and its children.
 *
 * `root` is what selectors are written from: the body, as `describeElement`
 * writes them for a picked element.
 */
export function readPageSnapshot(
  doc: Document,
  options?: { selector?: string; maxItems?: number },
): PageSnapshot {
  const win = doc.defaultView;
  const root = doc.body;
  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const outline: PageOutlineItem[] = [];
  let truncated = false;
  const scope =
    options?.selector !== undefined
      ? findBySelector(root, options.selector)
      : null;
  const walkRoot = scope ?? root;
  // A hidden element is skipped with all that is in it.
  const walker = doc.createTreeWalker(walkRoot, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (candidate) =>
      candidate instanceof Element && isHidden(candidate, win)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let node: Node | null = walker.currentNode;
  while (node !== null) {
    if (node instanceof Element) {
      const item = outlineItemOf(node, root, win);
      if (item !== null) {
        if (outline.length >= maxItems) {
          truncated = true;
          break;
        }
        outline.push(item);
      }
    }
    node = walker.nextNode();
  }
  const scrollY = Math.round(win?.scrollY ?? 0);
  return {
    url: win?.location.href ?? "",
    title: doc.title,
    viewport: {
      width: win?.innerWidth ?? 0,
      height: win?.innerHeight ?? 0,
      scrollY,
      pageHeight: Math.round(doc.documentElement.scrollHeight),
    },
    outline,
    ...(truncated ? { truncated: true } : {}),
    ...(scope !== null ? { element: detailOf(scope, root, win) } : {}),
    ...(options?.selector !== undefined && scope === null
      ? { notFound: options.selector }
      : {}),
  };
}

/**
 * The element a selector names, written as `describeElement` writes them --
 * from the body down, or from an element with an id -- or any selector a
 * person would write.
 */
export function findBySelector(
  root: Element,
  selector: string,
): Element | null {
  try {
    return (
      root.querySelector(`:scope > ${selector}`) ??
      root.ownerDocument.querySelector(selector)
    );
  } catch {
    return null;
  }
}

function outlineItemOf(
  element: Element,
  root: Element,
  win: Window | null,
): PageOutlineItem | null {
  const tag = element.tagName.toLowerCase();
  const base = () => ({
    tag,
    selector: selectorOf(element, root),
    box: boxOf(element, win),
  });
  const heading = /^h([1-6])$/.exec(tag);
  if (heading !== null) {
    return {
      kind: "heading",
      level: Number(heading[1]),
      text: textOf(element),
      ...base(),
    };
  }
  if (tag === "a") {
    const href = element.getAttribute("href") ?? undefined;
    return {
      kind: "link",
      ...(textOf(element) !== "" ? { text: textOf(element) } : {}),
      ...(href !== undefined ? { href } : {}),
      ...base(),
    };
  }
  if (tag === "button" || element.getAttribute("role") === "button") {
    return { kind: "button", text: textOf(element), ...base() };
  }
  if (tag === "img") {
    const alt = element.getAttribute("alt");
    const src = element.getAttribute("src");
    return {
      kind: "image",
      ...(alt !== null ? { alt } : {}),
      ...(src !== null ? { src: shorten(src) } : {}),
      ...base(),
    };
  }
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const label =
      element.getAttribute("aria-label") ??
      element.getAttribute("placeholder") ??
      element.getAttribute("name") ??
      "";
    return {
      kind: "input",
      ...(label !== "" ? { text: label } : {}),
      ...base(),
    };
  }
  if (
    tag === "header" ||
    tag === "nav" ||
    tag === "main" ||
    tag === "section" ||
    tag === "footer" ||
    tag === "aside"
  ) {
    return { kind: "section", ...base() };
  }
  // Text: an element that holds words of its own, not only through children
  // already listed (a heading, a link) -- a paragraph, a list item, a label.
  if (
    tag === "p" ||
    tag === "li" ||
    tag === "blockquote" ||
    tag === "figcaption" ||
    tag === "label" ||
    tag === "td" ||
    tag === "th" ||
    hasOwnText(element)
  ) {
    const text = textOf(element);
    if (text === "" || insideListed(element)) return null;
    return { kind: "text", text, ...base() };
  }
  return null;
}

/**
 * Already part of something the outline names: a link's or a button's words,
 * or a `<strong>` in a paragraph that is listed whole.
 */
function insideListed(element: Element): boolean {
  const parent = element.parentElement;
  return (
    parent !== null &&
    parent.closest(
      "a, button, h1, h2, h3, h4, h5, h6, [role='button'], p, li, blockquote, figcaption, label, td, th",
    ) !== null
  );
}

function hasOwnText(element: Element): boolean {
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 3 && (child.textContent ?? "").trim() !== "") {
      return true;
    }
  }
  return false;
}

function detailOf(
  element: Element,
  root: Element,
  win: Window | null,
): PageElementDetail {
  const styles: Record<string, string> = {};
  const computed = win?.getComputedStyle(element) ?? null;
  if (computed !== null) {
    for (const property of STYLES) {
      const value = computed.getPropertyValue(property);
      if (value !== "" && value !== "none" && value !== "normal") {
        styles[property] = value;
      }
    }
  }
  const box = boxOf(element, win);
  const lineHeight =
    computed !== null
      ? parseFloat(computed.getPropertyValue("line-height"))
      : NaN;
  const lines =
    Number.isFinite(lineHeight) && lineHeight > 0 && box.height > 0
      ? Math.max(1, Math.round(box.height / lineHeight))
      : undefined;
  return {
    selector: selectorOf(element, root),
    tag: element.tagName.toLowerCase(),
    text: textOf(element),
    box,
    ...(lines !== undefined ? { lines } : {}),
    styles,
    children: Array.from(element.children)
      .slice(0, MAX_CHILDREN)
      .map((child) => {
        const text = textOf(child);
        return {
          tag: child.tagName.toLowerCase(),
          selector: selectorOf(child, root),
          ...(text !== "" ? { text } : {}),
          box: boxOf(child, win),
        };
      }),
  };
}

function isHidden(element: Element, win: Window | null): boolean {
  const tag = element.tagName.toLowerCase();
  if (
    tag === "script" ||
    tag === "style" ||
    tag === "noscript" ||
    tag === "template"
  ) {
    return true;
  }
  // The picker's own outlines, and what the page hides from everyone.
  if (
    element.hasAttribute("data-val-picker") ||
    element.hasAttribute("hidden") ||
    element.getAttribute("aria-hidden") === "true"
  ) {
    return true;
  }
  const style = win?.getComputedStyle(element);
  return style?.display === "none" || style?.visibility === "hidden";
}

function boxOf(element: Element, win: Window | null): PageBox {
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left + (win?.scrollX ?? 0)),
    y: Math.round(rect.top + (win?.scrollY ?? 0)),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function textOf(element: Element): string {
  return shorten((element.textContent ?? "").replace(/\s+/g, " ").trim());
}

function shorten(text: string): string {
  return text.length > TEXT_LENGTH
    ? `${text.slice(0, TEXT_LENGTH - 1)}…`
    : text;
}

/** As `describeElement` writes it: from `root` down, or from an id. */
function selectorOf(element: Element, root: Element): string {
  const parts: string[] = [];
  let at: Element | null = element;
  while (at !== null && at !== root) {
    const tag = at.tagName.toLowerCase();
    if (at.id !== "") {
      parts.unshift(`${tag}#${at.id}`);
      break;
    }
    const parent: Element | null = at.parentElement;
    const same =
      parent === null
        ? []
        : Array.from(parent.children).filter(
            (sibling) => sibling.tagName === at?.tagName,
          );
    parts.unshift(
      same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(at) + 1})` : tag,
    );
    at = parent;
  }
  return parts.join(" > ");
}
