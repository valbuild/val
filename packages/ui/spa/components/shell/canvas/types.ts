/**
 * Types for the canvas experiment.
 *
 * The idea under test: show the page itself on a pan/zoom canvas, and put
 * every editable field on it into a panel at the side, so editing is a list
 * you work down rather than a hunt across the page. Selection is shared —
 * picking a field highlights it on the canvas, picking an element on the
 * canvas scrolls to its field — and anything selected can be handed to the
 * assistant as context.
 */

/** What kind of control a field gets in the side panel. */
export type CanvasFieldType = "string" | "text" | "richtext" | "image" | "link";

/** One editable field on the page. */
export type CanvasField = {
  id: string;
  /** Label in the side panel, e.g. "Headline". */
  label: string;
  type: CanvasFieldType;
  /** Current value. Images hold a file path. */
  value: string;
  /** The val source path, shown in dev mode. */
  sourcePath: string;
  /** Section this field belongs to, for grouping in the panel. */
  section: string;
};

/** A group of fields, matching a section of the page. */
export type CanvasSection = {
  id: string;
  name: string;
  fieldIds: string[];
};

/** The page being displayed, as data the canvas and the panel both read. */
export type CanvasPageData = {
  title: string;
  urlPath: string;
  sections: CanvasSection[];
  fields: Record<string, CanvasField>;
};

/** Widths the canvas can render the page at. */
/**
 * What the canvas is showing, and therefore what the column beside it holds.
 *
 * `normal` is the page as a visitor sees it: links work, nothing is outlined,
 * and the column keeps the module editor. `fields` is the page as Val sees
 * it: every element it tracks is outlined, and the column swaps to the fields
 * actually found on the page. One control drives both, because they are one
 * idea — whether you are looking at the page or at its content.
 */
export type CanvasView = "normal" | "fields";

export type CanvasDevice = "desktop" | "tablet" | "mobile";

export const CANVAS_DEVICE_WIDTHS: Record<CanvasDevice, number> = {
  desktop: 1280,
  tablet: 834,
  mobile: 390,
};

/**
 * Heights to give a page that does not have one of its own.
 *
 * The demo page is as tall as its content, but a real page arrives in an
 * iframe, and an iframe has no intrinsic height — left to itself it collapses
 * to a couple of hundred pixels regardless of what is inside it. These are the
 * viewport heights that go with the widths above, so what the canvas shows is
 * the page at a plausible screen size rather than at whatever an unsized frame
 * happens to be.
 */
export const CANVAS_DEVICE_HEIGHTS: Record<CanvasDevice, number> = {
  desktop: 800,
  tablet: 1112,
  mobile: 844,
};

/** A point on the page, in the page's own unscaled coordinates. */
export type CanvasPoint = {
  x: number;
  y: number;
};

/**
 * Where the canvas is looking: how far it is zoomed, and how far the window
 * around the page is scrolled.
 *
 * `x` and `y` are a SCROLL position, not a translation. They were a
 * translation while the page floated on a canvas; now it sits in a window that
 * scrolls, and the browser owns the movement. The shape is unchanged so the
 * `canvas-at` link parameter keeps working — an old link restores the right
 * zoom, and its offsets, which were negative, clamp to the top left.
 */
export type CanvasTransform = {
  /** 1 = 100%. */
  scale: number;
  x: number;
  y: number;
};
