import { mergeNeedsBuild } from "./mergeNeedsBuild";

/*
 * Publish in a proposal from a page that cannot build: a builder tab is
 * opened at the tap only for a merge that will build. On an iPhone a content
 * only merge opened one, which then found nothing to build.
 */
describe("whether a merge needs a build", () => {
  test("a proposal of content alone does not: it is a ref update", () => {
    expect(
      mergeNeedsBuild({
        staged: { files: [], inputs: null, buildRequired: false },
      }),
    ).toBe(false);
  });

  test("code built from what is staged does not: the merge goes live on that build", () => {
    expect(
      mergeNeedsBuild({
        staged: {
          files: ["src/routes/_site.index.tsx"],
          inputs: "i1",
          buildRequired: false,
        },
      }),
    ).toBe(false);
  });

  test("code not built yet does", () => {
    expect(
      mergeNeedsBuild({
        staged: {
          files: ["src/routes/_site.index.tsx"],
          inputs: "i1",
          buildRequired: true,
        },
      }),
    ).toBe(true);
  });

  test("a proposal not read yet, or a read without its staged files, does", () => {
    expect(mergeNeedsBuild(null)).toBe(true);
    expect(mergeNeedsBuild({})).toBe(true);
  });
});
