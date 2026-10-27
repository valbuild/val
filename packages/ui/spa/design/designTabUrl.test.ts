import { designProposalOf, designTabUrl } from "./designTabUrl";

const NAME = "3f9c1e7a2b4d6c8e0a1b";

describe("the design tab's address", () => {
  test("is on the site, under /val/design", () => {
    expect(designTabUrl("https://nordic.valstart.dev", NAME)).toBe(
      `https://nordic.valstart.dev/val/design/${NAME}`,
    );
    // A site URL with a path of its own is still the site's origin.
    expect(designTabUrl("https://nordic.valstart.dev/shop", NAME)).toBe(
      `https://nordic.valstart.dev/val/design/${NAME}`,
    );
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
