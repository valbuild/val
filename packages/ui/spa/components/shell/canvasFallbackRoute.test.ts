import { canvasFallbackRoute } from "./canvasFallbackRoute";

/**
 * Where the canvas points when the editor is not on a page.
 *
 * Compare, Errors, a data module, the media panel — none of them names a page,
 * and the canvas still has to point somewhere.
 */
describe("canvasFallbackRoute", () => {
  test("the root, where Val tracks it", () => {
    expect(canvasFallbackRoute(["/", "/blogs/one"])).toBe("/");
  });

  /**
   * The case this exists for: plenty of sites have a static home page, or start
   * their content at `/blog`. Loading `/` then shows a page Val knows nothing
   * about — no fields, nothing selectable — which reads as a broken canvas
   * rather than as a page that is not Val's.
   */
  test("the first tracked route, where it does not", () => {
    expect(canvasFallbackRoute(["/blogs/two", "/blogs/one"])).toBe(
      "/blogs/two",
    );
  });

  test("the root when there are no routes at all", () => {
    // A project of pure content files. There is nothing better to offer, and
    // the canvas is still a browser pointed at the site.
    expect(canvasFallbackRoute([])).toBe("/");
  });

  test("takes the list's order, which the caller has already sorted", () => {
    expect(canvasFallbackRoute(["/a", "/b"])).toBe("/a");
    expect(canvasFallbackRoute(["/b", "/a"])).toBe("/b");
  });
});
