import { QUICK_PREVIEW_PARAM } from "@valbuild/shared/internal";

/** The page, opened as the quick preview `id` (`quickPreview.ts`). */
export function withQuickPreview(url: string, id: string | null): string {
  if (id === null) return url;
  const [path, hash] = splitHash(url);
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${QUICK_PREVIEW_PARAM}=${encodeURIComponent(id)}${hash}`;
}

function splitHash(url: string): [string, string] {
  const at = url.indexOf("#");
  return at === -1 ? [url, ""] : [url.slice(0, at), url.slice(at)];
}

/**
 * Which document the canvas holds, besides the page it was asked for: a
 * build (`documentKey`) and, while one is shown, a quick preview.
 */
export type CanvasDocument = {
  documentKey: string | number;
  quick: string | null;
};

export function sameDocument(a: CanvasDocument, b: CanvasDocument): boolean {
  return a.documentKey === b.documentKey && a.quick === b.quick;
}

/**
 * Whether the canvas's page has the focus: someone is typing in it, or has
 * just clicked in it. A new document waits until they leave it -- a reload
 * under their hands would throw away what they typed and where they were.
 * The frame is the active element of its root (the Studio's shadow root, or
 * the document) while focus is anywhere inside the page.
 */
export function frameHasFocus(frame: HTMLIFrameElement | null): boolean {
  if (frame === null) return false;
  const root = frame.getRootNode();
  const active =
    root instanceof ShadowRoot || root instanceof Document
      ? root.activeElement
      : null;
  return active === frame;
}

/** What a `<body>` holds that is not something to look at. */
const NOT_CONTENT = new Set([
  "SCRIPT",
  "STYLE",
  "LINK",
  "TEMPLATE",
  "NOSCRIPT",
]);

/**
 * Whether the page in `frame` has rendered anything: an element in its
 * `<body>` that is not a script or a style. The canvas frames the site the
 * Studio is on, so its document can be read; where it cannot -- another
 * origin, a frame that is gone -- the answer is yes, because waiting on
 * something that cannot be seen is waiting for nothing.
 */
export function frameHasContent(frame: HTMLIFrameElement | null): boolean {
  if (frame === null) return true;
  let body: HTMLElement | null | undefined;
  try {
    body = frame.contentDocument?.body;
  } catch {
    return true;
  }
  if (body === null || body === undefined) return true;
  return Array.from(body.children).some(
    (element) => !NOT_CONTENT.has(element.tagName),
  );
}
