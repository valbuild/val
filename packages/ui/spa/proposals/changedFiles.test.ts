import { changedFiles } from "./changedFiles";

describe("what a proposal changes of the site's files", () => {
  test("added, modified and deleted, by path, saying which are staged code", () => {
    expect(
      changedFiles(
        {
          "src/routes/_site.index.tsx": "home",
          "src/components/Quote.tsx": "quote",
          "src/routes/_site.index.val.ts": "content",
        },
        {
          "src/routes/_site.index.tsx": "home, with testimonials",
          "src/components/Quote.tsx": null,
          "src/components/Testimonials.tsx": "testimonials",
          "src/routes/_site.index.val.ts": "content, saved",
        },
        [
          "src/routes/_site.index.tsx",
          "src/components/Quote.tsx",
          "src/components/Testimonials.tsx",
        ],
      ),
    ).toEqual([
      { path: "src/components/Quote.tsx", change: "deleted", staged: true },
      {
        path: "src/components/Testimonials.tsx",
        change: "added",
        staged: true,
      },
      { path: "src/routes/_site.index.tsx", change: "modified", staged: true },
      {
        path: "src/routes/_site.index.val.ts",
        change: "modified",
        staged: false,
      },
    ]);
  });

  test("a file written with the site's text, or deleted where the site has none, is no change", () => {
    expect(
      changedFiles({ "a.ts": "same" }, { "a.ts": "same", "b.ts": null }, []),
    ).toEqual([]);
  });
});
