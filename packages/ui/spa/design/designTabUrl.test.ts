import { designProposalOf, designTabUrl } from "./designTabUrl";

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
});
