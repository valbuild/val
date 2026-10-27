import { normalizeRoute } from "./CanvasRouteBar";

/**
 * What the canvas's address bar accepts.
 *
 * The rule is that the canvas only ever loads a path on this host, and it is a
 * rule with teeth: the frame has to stay same-origin for the studio to be able
 * to talk to it at all. A page from somewhere else can never answer, and the
 * canvas would look broken for a reason nothing on screen explains — so the
 * input is normalised rather than trusted.
 */
describe("normalizeRoute", () => {
  test("leaves a path alone", () => {
    expect(normalizeRoute("/blogs/blog1")).toBe("/blogs/blog1");
  });

  test("roots a path that is not rooted", () => {
    // Typing `blogs/blog1` means the same thing as `/blogs/blog1` to everyone
    // except a URL parser.
    expect(normalizeRoute("blogs/blog1")).toBe("/blogs/blog1");
  });

  test("keeps the path of an absolute URL, and drops the host", () => {
    // Pasting a URL is the obvious thing to do, and the path is what was meant.
    expect(normalizeRoute("http://localhost:3000/blogs/blog1")).toBe(
      "/blogs/blog1",
    );
    expect(normalizeRoute("https://example.com/pricing?a=1#top")).toBe(
      "/pricing?a=1#top",
    );
  });

  test("a bare host is the site's root", () => {
    expect(normalizeRoute("https://example.com")).toBe("/");
  });

  test("empty is the root, not an empty route", () => {
    expect(normalizeRoute("")).toBe("/");
    expect(normalizeRoute("   ")).toBe("/");
  });

  test("trims, because a pasted route brings whitespace with it", () => {
    expect(normalizeRoute("  /about  ")).toBe("/about");
  });

  test("keeps a query and a hash on a relative route", () => {
    // Both are part of the address, and a preview of `?variant=b` is a
    // different page than a preview without it.
    expect(normalizeRoute("/search?q=val#results")).toBe(
      "/search?q=val#results",
    );
  });
});
