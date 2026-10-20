/**
 * A Val demo, as the page hands it to the Studio.
 *
 * In a demo the Studio talks to Val's own server running in the same tab
 * (`@valbuild/server/browser`) instead of to an API route, and the page that
 * starts that server is the app's (`<ValApp demo>`) while the Studio is a
 * separate bundle loaded by a script tag. A window property is how the two
 * meet, the same way `window.__VAL_MODULES__` hands the Studio the project's
 * modules. See `docs/plans/demo-mode.md`.
 */
export type ValDemoRuntime = {
  /**
   * Sends a Studio request to the in-tab server. Passed to `createValClient`.
   *
   * The server holds its edits in memory, so starting the demo over is
   * reloading the page: there is nothing stored to clear.
   */
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /**
   * Whether uploads work here. They need the demo's service worker, which
   * relays the upload and the unpublished files to this tab's server, and a
   * service worker needs a secure context. Where it cannot run the Studio
   * refuses uploads before sending anything, and says why.
   */
  uploads: boolean;
  /**
   * The tour the site wrote, in place of the Studio's own demo tour. See
   * `ValDemoTourStep`. Absent: the Studio's.
   */
  tour?: ValDemoTourStep[];
};

/**
 * What the site starts the demo with: `<ValApp demo={{ tour }}>`.
 *
 * `demo` alone (`true`) is the same with nothing given.
 */
export type ValDemoOptions = {
  tour?: ValDemoTourStep[];
};

/**
 * A control of the Studio's a step can point at.
 *
 * The `data-val-tour` markers the Studio puts on them. One that is not on
 * screen (the rail on a phone) leaves the card on its own, so a step's words
 * must work without the arrow: never "this button here".
 */
export type ValDemoTourTarget =
  | "canvas"
  | "pages"
  | "media"
  | "data"
  | "review"
  | "preview"
  | "publish"
  | "ai"
  | "locale"
  | "demo"
  | "utility";

/** A panel a step opens, so what it is about is on screen behind the card. */
export type ValDemoTourPanel = "pages" | "media" | "data" | "settings" | "ai";

/**
 * What moves a step on by itself. A step without one has Next.
 *
 * Each is something the visitor does, because doing it is the lesson, and
 * each has a "Do it for me" that does it the way the Studio would:
 *
 * - `open`: a field at or below this source path is opened -- by clicking it
 *   on the page, or anywhere else. Do it for me opens it.
 * - `edit`: a change is made. Do it for me writes `value` at `path`; without
 *   them, it is offered nowhere and the step waits for the visitor.
 * - `panel`: that panel is opened. Do it for me opens it.
 * - `locale`: the language shown is changed. Do it for me picks the next one.
 */
export type ValDemoTourMoveOn =
  | { open: string }
  | { edit: true; path?: string; value?: string }
  | { panel: ValDemoTourPanel }
  | { locale: true };

/**
 * One stop of the demo's tour, as the site writes it.
 *
 * Data rather than components, so the tour can be rewritten -- and tried on
 * people -- without a Val release: the Studio draws it, the site says what it
 * says. Written for someone who has never seen Val.
 */
export type ValDemoTourStep = {
  /** Stable, so a test can name a step without matching its words. */
  id: string;
  title: string;
  body: string;
  /** The control this step is about. */
  target?: ValDemoTourTarget;
  /**
   * A field this step is about, as a source path: ringed wherever the Studio
   * shows it -- the page's fields, or the module open in the editor. Takes
   * precedence over `target`, which is what is ringed when the field is not
   * on screen.
   */
  field?: string;
  /**
   * A place on the page this step is about, as a source path: the page
   * outlines it and brings it into view.
   */
  page?: string;
  panel?: ValDemoTourPanel;
  moveOn?: ValDemoTourMoveOn;
};

/*
 * A global `var` rather than a `Window` member: this package is compiled
 * without the DOM's types, and a `var` in global scope is also a property of
 * `window` where they exist.
 */
declare global {
  var __VAL_DEMO__: ValDemoRuntime | undefined;
}

/** The demo this page was started with, or null outside a demo. */
export function getValDemo(): ValDemoRuntime | null {
  return globalThis.__VAL_DEMO__ ?? null;
}
