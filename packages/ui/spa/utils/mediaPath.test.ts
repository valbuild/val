import { servedPath } from "./mediaPath";

/**
 * What a file's path looks like to someone reading it.
 *
 * `/public` is the web root, so a ref and the URL it is served at differ by
 * exactly that prefix. Showing the ref meant every path in the Studio disagreed
 * with every path in the site's own markup.
 */
describe("servedPath", () => {
  test("drops the public prefix", () => {
    expect(servedPath("/public/val/logo_a1b2c.png")).toBe(
      "/val/logo_a1b2c.png",
    );
  });

  test("drops it from a directory too", () => {
    expect(servedPath("/public/val/images")).toBe("/val/images");
  });

  test("leaves a path outside the public folder alone", () => {
    // Served from wherever it says — `mediaUrl` uses the path as-is.
    expect(servedPath("/content/attachments/a.pdf")).toBe(
      "/content/attachments/a.pdf",
    );
  });

  test("leaves a remote ref alone", () => {
    const ref =
      "https://remote.val.build/file/p/abc/b/main/v/0.100.0/h/deadbeef/f/public/val/x.png";
    expect(servedPath(ref)).toBe(ref);
  });

  test("only matches the prefix at the start", () => {
    // A folder that happens to be called `public` deeper down is not the root.
    expect(servedPath("/content/public/a.png")).toBe("/content/public/a.png");
  });

  test("the public folder itself becomes the root", () => {
    expect(servedPath("/public")).toBe("");
  });
});
