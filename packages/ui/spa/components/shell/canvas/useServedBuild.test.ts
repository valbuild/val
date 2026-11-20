import { nextBuildEpoch } from "./useServedBuild";

/**
 * The preview loads the page again when the server serves ANOTHER build:
 * the page in the frame is the old build's document until then. Learning the
 * name of the build it was loaded from is not another build.
 */
describe("which document the preview holds, as far as the build goes", () => {
  const start = { build: null, epoch: 0 };

  test("the first build named is the one the page was loaded from", () => {
    expect(nextBuildEpoch(start, "/_app/val-modules-b1.js")).toEqual({
      build: "/_app/val-modules-b1.js",
      epoch: 0,
    });
  });

  test("another build is a new document", () => {
    const b1 = nextBuildEpoch(start, "/_app/val-modules-b1.js");
    expect(nextBuildEpoch(b1, "/_app/val-modules-b2.js")).toEqual({
      build: "/_app/val-modules-b2.js",
      epoch: 1,
    });
  });

  test("the same build again is not", () => {
    const b1 = nextBuildEpoch(start, "/_app/val-modules-b1.js");
    expect(nextBuildEpoch(b1, "/_app/val-modules-b1.js")).toBe(b1);
  });

  test("a manifest that names no build keeps the last one", () => {
    const b1 = nextBuildEpoch(start, "/_app/val-modules-b1.js");
    const unnamed = nextBuildEpoch(b1, null);
    expect(unnamed).toEqual(b1);
    expect(nextBuildEpoch(unnamed, "/_app/val-modules-b1.js")).toEqual(b1);
  });
});
