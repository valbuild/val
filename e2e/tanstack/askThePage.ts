import type { Page } from "@playwright/test";

/** The Studio's preview of the site: its frame. */
export const PREVIEW = 'iframe[title^="Preview of"]';

/**
 * Post a request into the preview from the Studio -- the frame's parent, at
 * the page's own origin, which is all the bridge answers -- and wait for the
 * answer with the same `requestId`: the page's half of a canvas request,
 * asked the way the Studio asks it.
 */
export function askThePage(
  page: Page,
  request: Record<string, unknown>,
  answerType: string,
  /** How long to wait for the answer. */
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ selector, request, answerType, timeoutMs }) => {
      // The preview lives in the Studio's shadow root.
      const frame =
        document
          .querySelector("#val-shadow-root")
          ?.shadowRoot?.querySelector<HTMLIFrameElement>(selector) ??
        document.querySelector<HTMLIFrameElement>(selector);
      const target = frame?.contentWindow;
      if (!target) throw new Error("no preview");
      const requestId = `e2e-${Math.random()}`;
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no ${answerType}`)),
          timeoutMs,
        );
        window.addEventListener("message", function listen(event) {
          const data: unknown = event.data;
          if (
            typeof data === "object" &&
            data !== null &&
            Reflect.get(data, "type") === answerType &&
            Reflect.get(data, "requestId") === requestId
          ) {
            clearTimeout(timer);
            window.removeEventListener("message", listen);
            resolve(Object.fromEntries(Object.entries(data)));
          }
        });
        target.postMessage(
          { val: "val-canvas", ...request, requestId },
          window.origin,
        );
      });
    },
    { selector: PREVIEW, request, answerType, timeoutMs },
  );
}
