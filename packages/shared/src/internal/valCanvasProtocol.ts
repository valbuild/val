/**
 * The protocol between the studio's canvas and the page inside it.
 *
 * The canvas shows the running site in a frame. That frame is a different
 * document — the customer's app, rendered by their components — so the studio
 * cannot reach into it, and it cannot reach out. Everything they say to each
 * other goes through `postMessage`, and this is the vocabulary.
 *
 * It lives in `shared` because both halves have to agree on it: the page half
 * ships in `@valbuild/next`, the studio half in `@valbuild/ui`, and a message
 * shape defined twice is a message shape that will differ once.
 *
 * ## Why a query parameter turns it on
 *
 * The frame has to render the page as Val sees it — draft content, with
 * `data-val-path` on every element Val tracks — while *not* showing Val's own
 * overlay, because the studio is already the UI. Nothing about the cookies can
 * express that: they are per-origin, and the studio and the page share an
 * origin, so a cookie would change the customer's own tabs too. A parameter on
 * the frame's URL is scoped to exactly the one document that needs it.
 */

import type { ModuleFilePath, SourcePath } from "@valbuild/core";

/** Marks a page load as the studio's canvas frame. */
export const VAL_CANVAS_PARAM = "val_canvas";

/**
 * Every message is tagged with this, and the tag is checked on receipt.
 *
 * A window receives messages from anything that has a handle on it —
 * extensions, embeds, other frames — and `event.data` is whatever they chose to
 * send. Checking a discriminator before reading anything else is what keeps a
 * stray message from being read as a canvas instruction.
 */
export const VAL_CANVAS_MESSAGE = "val-canvas";

/** One element on the page that Val has a path for. */
export type ValCanvasElement = {
  /**
   * The paths on the element, already split.
   *
   * `data-val-path` holds a comma-separated list, because one element can
   * render more than one piece of content — a heading built from two fields is
   * one element with two paths.
   *
   * Typed as `SourcePath` rather than `string` because that is what they are:
   * the page splits the attribute with Val's own splitter, so the values arrive
   * already being paths. Saying so here is what keeps every reader of them from
   * having to assert it again.
   */
  paths: SourcePath[];
  /** Where it is, in the page's own coordinates (unscaled, page-relative). */
  rect: { top: number; left: number; width: number; height: number };
};

/** What the page tells the studio. */
export type ValCanvasPageMessage =
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "ready";
      /**
       * Whether the page is actually rendering draft content.
       *
       * The studio asks the server the same question, but the server answers
       * for the *next* request; this answers for the document on screen, which
       * is the one the person is looking at.
       */
      draftMode: boolean;
      /** The URL the frame ended up on, which a redirect may have changed. */
      url: string;
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "elements";
      elements: ValCanvasElement[];
      /** The page's full layout size, for mapping a click back to an element. */
      pageSize: { width: number; height: number };
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "clicked";
      /** The paths on the element that was clicked. */
      paths: SourcePath[];
    };

/** What the studio tells the page. */
export type ValCanvasStudioMessage =
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "rescan";
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "highlight";
      /** The path to outline, or null to clear the outline. */
      path: SourcePath | null;
      /** Bring it into view as well as outlining it. */
      scrollIntoView?: boolean;
    }
  | {
      /**
       * A module's source moved, so the page should re-render with it.
       *
       * The page already knows how to do this — it is what makes an inline edit
       * visible behind the overlay — but it learns about it from a CustomEvent
       * on its own window, and the studio is in a different window. So the
       * update is relayed and the bridge re-dispatches it where the page is
       * listening.
       *
       * Without it the canvas is only correct immediately after a load: a
       * server component re-reads content when the page is requested, so
       * everything typed since then is invisible until a reload.
       */
      val: typeof VAL_CANVAS_MESSAGE;
      type: "sourceUpdate";
      moduleFilePath: ModuleFilePath;
      /**
       * The whole module source. `unknown` because the page's own types are the
       * ones that give it meaning; nothing in between should be interpreting it.
       */
      source: unknown;
    }
  | {
      val: typeof VAL_CANVAS_MESSAGE;
      type: "setPicking";
      /**
       * Whether a click picks an element instead of doing what the page would
       * do with it.
       *
       * Off by default: in the normal view the canvas is the page, and a click
       * on a link should follow the link.
       */
      picking: boolean;
    };

/** Narrow an unknown `event.data` to a message from the page. */
export function isValCanvasPageMessage(
  data: unknown,
): data is ValCanvasPageMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as { val?: unknown; type?: unknown };
  if (message.val !== VAL_CANVAS_MESSAGE) return false;
  return (
    message.type === "ready" ||
    message.type === "elements" ||
    message.type === "clicked"
  );
}

/** Narrow an unknown `event.data` to a message from the studio. */
export function isValCanvasStudioMessage(
  data: unknown,
): data is ValCanvasStudioMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as { val?: unknown; type?: unknown };
  if (message.val !== VAL_CANVAS_MESSAGE) return false;
  return (
    message.type === "rescan" ||
    message.type === "highlight" ||
    message.type === "setPicking" ||
    message.type === "sourceUpdate"
  );
}

/**
 * Whether this document was loaded as the studio's canvas frame.
 *
 * Reads the location directly rather than taking it as an argument, because
 * every caller wants the answer for the document it is running in, and passing
 * it around is how one of them ends up asking about the wrong one.
 */
export function isValCanvasFrame(search: string): boolean {
  try {
    return new URLSearchParams(search).get(VAL_CANVAS_PARAM) !== null;
  } catch {
    return false;
  }
}

/** Add the canvas marker to a page URL. */
export function withValCanvasParam(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${VAL_CANVAS_PARAM}=1`;
}
