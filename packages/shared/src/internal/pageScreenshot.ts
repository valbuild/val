/**
 * A picture of the page, taken in the page: the assistant's
 * `screenshot_page`, so it can see a change it made rather than only read it
 * (`read_page` gives the words and the boxes).
 *
 * Taken HERE because nothing else can: the design tab is another origin than
 * the proposal's page in its frame, and a browser lets no page photograph a
 * frame of another origin. So the bridge renders its own document --
 * `modern-screenshot` draws the DOM, with its computed styles, fonts and
 * same-origin images, into a canvas -- and hands back a JPEG.
 *
 * It is a rendering of the DOM, not of the screen: an image from another
 * origin that does not allow it, a video frame, a `<canvas>` a script drew
 * and an iframe come out blank. Good enough to see a layout, a colour, a
 * button that wrapped; the tool says what it cannot show.
 *
 * Loaded when asked: the library is not in a page that is never
 * photographed.
 */

/** What `screenshotPage` answers. */
export type PageScreenshot = {
  /** A JPEG, as a data URL. */
  dataUrl: string;
  width: number;
  height: number;
  /** The whole page, from the top, rather than what was on screen. */
  fullPage: boolean;
  /** The page went on below what the picture shows. */
  clipped: boolean;
};

/** Wider than this is scaled down: a model reads a page no better larger. */
const MAX_WIDTH = 1280;
/** A whole page longer than this, in CSS pixels, is cut off below it. */
const MAX_FULL_PAGE_HEIGHT = 4000;
const JPEG_QUALITY = 0.85;
/** How long an image or a font on the page is waited for. */
const LOAD_TIMEOUT_MS = 8_000;

/**
 * The page in `win`, as it is now: what is on screen, or (`fullPage`) the
 * whole page from the top, cut off at {@link MAX_FULL_PAGE_HEIGHT}. Elements
 * `exclude` says are not the page's -- the picker's highlight -- are left
 * out.
 */
export async function screenshotPage(
  win: Window,
  options: { fullPage?: boolean; exclude?: (element: Element) => boolean } = {},
): Promise<PageScreenshot> {
  const { domToCanvas } = await import("modern-screenshot");
  const doc = win.document;
  const root = doc.documentElement;
  const fullPage = options.fullPage === true;
  const pageWidth = root.clientWidth || win.innerWidth;
  const pageHeight = Math.max(root.scrollHeight, doc.body?.scrollHeight ?? 0);
  const top = fullPage ? 0 : win.scrollY;
  const height = fullPage
    ? Math.min(pageHeight, MAX_FULL_PAGE_HEIGHT)
    : Math.min(win.innerHeight, pageHeight - top);
  const exclude = options.exclude;
  // Drawn to the bottom of what is wanted, and no further: the cost is the
  // page's size, so a viewport near the top is cheap.
  const drawn = await domToCanvas(root, {
    width: pageWidth,
    height: top + height,
    scale: 1,
    backgroundColor: pageBackground(win),
    timeout: LOAD_TIMEOUT_MS,
    ...(exclude !== undefined
      ? {
          filter: (node: Node) => !(isElement(node) && exclude(node)),
        }
      : {}),
  });
  const scale = Math.min(1, MAX_WIDTH / pageWidth);
  const out = doc.createElement("canvas");
  out.width = Math.round(pageWidth * scale);
  out.height = Math.round(height * scale);
  const context = out.getContext("2d");
  if (context === null) {
    throw new Error("This browser would not draw the picture.");
  }
  context.drawImage(
    drawn,
    0,
    top,
    pageWidth,
    height,
    0,
    0,
    out.width,
    out.height,
  );
  return {
    dataUrl: out.toDataURL("image/jpeg", JPEG_QUALITY),
    width: out.width,
    height: out.height,
    fullPage,
    clipped: top + height < pageHeight,
  };
}

/** What the page is drawn on: the body's background, else the root's, else white. */
function pageBackground(win: Window): string {
  for (const element of [win.document.body, win.document.documentElement]) {
    if (element === null) continue;
    const color = win.getComputedStyle(element).backgroundColor;
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") {
      return color;
    }
  }
  return "#ffffff";
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}
