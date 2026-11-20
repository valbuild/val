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
