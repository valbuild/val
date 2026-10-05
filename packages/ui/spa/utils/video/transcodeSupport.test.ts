import { renditionHeights } from "./transcodeSupport";

describe("renditionHeights", () => {
  test("keeps the heights the upload can fill, tallest first", () => {
    expect(renditionHeights([480, 1080, 720], 1080)).toEqual([1080, 720, 480]);
    expect(renditionHeights([1080, 720, 480], 800)).toEqual([720, 480]);
  });
  test("never upscales: a short upload gets its own height", () => {
    expect(renditionHeights([1080, 720], 360)).toEqual([360]);
  });
  test("drops duplicates and nonsense", () => {
    expect(renditionHeights([720, 720, 0, -1], 1080)).toEqual([720]);
  });
});
