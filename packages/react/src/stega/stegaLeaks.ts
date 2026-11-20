import jsxDevRuntime from "react/jsx-dev-runtime";
import { VERCEL_STEGA_REGEX } from "@vercel/stega";
import { stegaDecodeStrings } from "./stegaDecodeStrings";

/**
 * Edit tags that left React: content whose invisible characters reached the
 * page somewhere `autoTagJSX` could not take them out -- JSON-LD written with
 * `dangerouslySetInnerHTML`, a `<title>` or `<meta>` set from a string,
 * `encodeURIComponent(title)` in a share link. Every visitor of a site with
 * content analytics on gets them after hydration, and so does any crawler
 * that runs the page. See `docs/plans/analytics.md`, "The leak warning".
 *
 * Anything that went through `autoTagJSX` is clean -- its tags were moved to
 * `data-val-path` -- so a tag found anywhere in the document is a leak.
 */
export type StegaLeak = {
  /** The source path the tag names: `/content/blog.val.ts?p="title"`. */
  path: string;
  /** Where it was found, as a person reads it: `<script type="application/ld+json">`. */
  where: string;
};

/** The attributes that tell an element apart from its siblings, in the order tried. */
const NAMING_ATTRIBUTES = ["type", "name", "property", "rel", "id"];

function describeElement(element: Element): string {
  const tag = element.tagName.toLowerCase();
  for (const name of NAMING_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value !== null && value !== "" && !hasTag(value)) {
      return `<${tag} ${name}="${value}">`;
    }
  }
  return `<${tag}>`;
}

function hasTag(value: string): boolean {
  return value.match(VERCEL_STEGA_REGEX) !== null;
}

/**
 * The paths tagged in `value`. A URL can carry a tag percent-encoded --
 * `encodeURIComponent` keeps the invisible characters, as `%E2%80%8B` -- so
 * that is decoded and looked in as well.
 */
function taggedPaths(value: string): string[] {
  if (hasTag(value)) {
    return stegaDecodeStrings(value) ?? [];
  }
  if (value.includes("%")) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      return [];
    }
    if (decoded !== value && hasTag(decoded)) {
      return stegaDecodeStrings(decoded) ?? [];
    }
  }
  return [];
}

/** Every edit tag in `root`'s document, in document order, each path and place once. */
export function findStegaLeaks(root: Document): StegaLeak[] {
  const leaks: StegaLeak[] = [];
  const seen = new Set<string>();
  const add = (paths: string[], where: string) => {
    for (const path of paths) {
      const key = `${path}\u0000${where}`;
      if (!seen.has(key)) {
        seen.add(key);
        leaks.push({ path, where });
      }
    }
  };
  const top = root.documentElement;
  if (!top) {
    return leaks;
  }
  const walker = root.createTreeWalker(
    top,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node: Node | null = walker.currentNode; node; ) {
    if (isElement(node)) {
      for (const attribute of Array.from(node.attributes)) {
        if (attribute.name === "data-val-path") continue;
        add(
          taggedPaths(attribute.value),
          `the ${attribute.name} attribute of ${describeElement(node)}`,
        );
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      const text = node.nodeValue;
      if (parent && text) {
        add(
          taggedPaths(text),
          isOwnText(parent)
            ? describeElement(parent)
            : `text in ${describeElement(parent)}`,
        );
      }
    }
    node = walker.nextNode();
  }
  return leaks;
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

/** Elements whose text is a value of its own, rather than text on the page. */
function isOwnText(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === "script" || tag === "style" || tag === "title";
}

/**
 * Whether the page runs React's development build: the one signal of
 * "development" that holds in every bundler. `process.env.NODE_ENV` does not
 * -- TanStack Start's dev server hands the browser a `process.env` without
 * it -- but the bundler resolved React's own copy of that check to pick a
 * build, and the production build's `react/jsx-dev-runtime` has no `jsxDEV`.
 */
export function isReactDevelopmentBuild(): boolean {
  const runtime: { jsxDEV?: unknown } = jsxDevRuntime;
  return typeof runtime.jsxDEV === "function";
}

export function stegaLeakMessage(leak: StegaLeak): string {
  return `Content from ${leak.path} reached ${leak.where} with its edit tag still in it. Wrap the value in val.raw() where it leaves React.`;
}

/**
 * Looks for leaks once the page has settled after a change -- after load,
 * after the render that adds edit tags, after every route change -- and
 * reports each path and place the first time it is found. For development:
 * walking the whole document is not something to do to a visitor.
 *
 * Returns what stops it.
 */
export function watchStegaLeaks(
  report: (leak: StegaLeak) => void,
  options: { root?: Document; settleMs?: number } = {},
): () => void {
  const root = options.root ?? document;
  const settleMs = options.settleMs ?? 1000;
  const reported = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const scan = () => {
    timer = null;
    for (const leak of findStegaLeaks(root)) {
      const key = `${leak.path}\u0000${leak.where}`;
      if (!reported.has(key)) {
        reported.add(key);
        report(leak);
      }
    }
  };
  const schedule = () => {
    // At most one scan per `settleMs`, however busy the page: the first
    // change starts the wait, later ones ride along with it.
    if (timer === null) {
      timer = setTimeout(scan, settleMs);
    }
  };
  const observer = new MutationObserver(schedule);
  if (root.documentElement) {
    observer.observe(root.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }
  schedule();
  return () => {
    observer.disconnect();
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
