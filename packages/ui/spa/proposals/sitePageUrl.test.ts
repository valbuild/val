import { siteOrigin, sitePageUrl } from "./sitePageUrl";

describe("sitePageUrl", () => {
  test("puts the route after the site's address", () => {
    expect(sitePageUrl("https://example.com", "/blogs/blog1")).toBe(
      "https://example.com/blogs/blog1",
    );
  });

  test("does not double the slash of an address that ends in one", () => {
    expect(sitePageUrl("https://example.com/", "/")).toBe(
      "https://example.com/",
    );
  });

  test("keeps a site served under a path", () => {
    expect(sitePageUrl("https://example.com/shop/", "/about")).toBe(
      "https://example.com/shop/about",
    );
  });
});

describe("siteOrigin", () => {
  test("is the origin of the address", () => {
    expect(siteOrigin("https://example.com/shop")).toBe("https://example.com");
  });

  test("is null for something that is not a URL", () => {
    expect(siteOrigin("example.com")).toBe(null);
  });

  test("is null for an address that is not on the web", () => {
    expect(siteOrigin("javascript:alert(1)")).toBe(null);
    expect(siteOrigin("data:text/html,hi")).toBe(null);
  });
});
