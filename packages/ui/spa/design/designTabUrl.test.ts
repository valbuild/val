import {
  designProposalOf,
  designTabUrl,
  previewUrl,
  siteDesignTabUrl,
} from "./designTabUrl";

const NAME = "3f9c1e7a2b4d6c8e0a1b";

describe("the design tab's address", () => {
  test("is on the site's address beside the proposal's, under /val/design", () => {
    // Not the custom domain: from there the proposal is another site, and
    // the frame of it would be signed out.
    expect(
      designTabUrl(
        `https://${NAME}--nordic.valstart.dev/val/pages?p=1`,
        NAME,
        "https://www.nordic.no",
      ),
    ).toBe(`https://nordic.valstart.dev/val/design/${NAME}`);
  });

  test("is on the site as content names it, where the address does not name the proposal", () => {
    expect(
      designTabUrl("http://localhost:8787/val", NAME, "https://www.nordic.no"),
    ).toBe(`https://www.nordic.no/val/design/${NAME}`);
    // A site URL with a path of its own is still the site's origin.
    expect(
      designTabUrl(
        "http://localhost:8787/val",
        NAME,
        "https://nordic.valstart.dev/shop",
      ),
    ).toBe(`https://nordic.valstart.dev/val/design/${NAME}`);
    // Another proposal's address is not this one's.
    expect(
      designTabUrl(
        `https://${"f".repeat(20)}--nordic.valstart.dev/val`,
        NAME,
        "https://www.nordic.no",
      ),
    ).toBe(`https://www.nordic.no/val/design/${NAME}`);
  });

  test("names its proposal, and nothing else does", () => {
    expect(designProposalOf(`/val/design/${NAME}`)).toBe(NAME);
    expect(designProposalOf(`/val/design/${NAME}/`)).toBe(NAME);
    for (const path of [
      "/val",
      "/val/design",
      "/val/design/",
      "/val/design/not-a-proposal",
      `/val/design/${NAME}/files`,
      `/val/design/${NAME.toUpperCase()}`,
      `/design/${NAME}`,
    ]) {
      expect([path, designProposalOf(path)]).toEqual([path, null]);
    }
  });

  test("beside the proposal's address, or none when this is not it", () => {
    expect(
      siteDesignTabUrl(`https://${NAME}--nordic.valstart.dev/val`, NAME),
    ).toBe(`https://nordic.valstart.dev/val/design/${NAME}`);
    expect(siteDesignTabUrl("https://nordic.valstart.dev/val", NAME)).toBe(
      null,
    );
    expect(siteDesignTabUrl(`https://${NAME}--.valstart.dev`, NAME)).toBe(null);
  });
});

describe("the page the frame shows", () => {
  const ADDRESS = `https://${NAME}--nordic.valstart.dev`;
  test("is a page of the proposal's address", () => {
    expect(previewUrl(ADDRESS, "/")).toBe(`${ADDRESS}/`);
    expect(previewUrl(`${ADDRESS}/`, "/products/a?x=1#y")).toBe(
      `${ADDRESS}/products/a?x=1#y`,
    );
  });

  test("and nothing else: not another host, not something that is not a path", () => {
    for (const route of [
      "//example.com",
      "//[",
      "https://example.com/",
      "products",
    ]) {
      expect([route, previewUrl(ADDRESS, route)]).toEqual([route, null]);
    }
    expect(previewUrl("not a url", "/")).toBe(null);
  });
});
