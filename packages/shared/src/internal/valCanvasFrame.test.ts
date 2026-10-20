import { isValCanvasFrame, withValCanvasParam } from "./valCanvasProtocol";

/**
 * Which documents are the studio's canvas.
 *
 * The parameter the studio puts on the frame's URL only marks the FIRST
 * document in it. A site with a login of its own redirects a signed-out canvas
 * to its sign-in page — a new document without the parameter — and that page
 * used to mount Val's whole overlay inside the canvas, which then never went
 * live. `e2e/tanstack/signedInPreview.spec.ts` drives that in a browser; this
 * is the rule it depends on.
 */
describe("isValCanvasFrame", () => {
  test("the document the studio loaded, by its parameter", () => {
    const search = new URL(withValCanvasParam("/dashboard"), "http://x").search;
    expect(isValCanvasFrame(search)).toBe(true);
    expect(isValCanvasFrame(search, null)).toBe(true);
  });

  test("an ordinary tab is not the canvas", () => {
    expect(isValCanvasFrame("")).toBe(false);
    expect(isValCanvasFrame("?redirect=%2Fdashboard", null)).toBe(false);
  });

  test("a document the canvas navigated to on its own, by where it sits", () => {
    // The site's login, reached by a redirect that dropped the parameter.
    const search = `?redirect=${encodeURIComponent(
      withValCanvasParam("/dashboard"),
    )}`;
    expect(isValCanvasFrame(search, "/val")).toBe(true);
    expect(
      isValCanvasFrame(search, "/val/~/src/routes/_site.dashboard.val.ts"),
    ).toBe(true);
  });

  test("a frame on some other page of the site is not the canvas", () => {
    expect(isValCanvasFrame("", "/")).toBe(false);
    expect(isValCanvasFrame("", "/valley")).toBe(false);
    expect(isValCanvasFrame("", "/blog/val")).toBe(false);
  });
});
