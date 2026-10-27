import { optimizeTreePath } from "./optimizeTreePath";

describe("optimizeTreePath", () => {
  it("should optimize the tree path", () => {
    const ids = ["/content/test", "/content/test/1", "/content/test/2"];
    const optimizedPath = optimizeTreePath(ids);
    expect(optimizedPath).toEqual("/content/test");
  });

  it("should find the correct base tree path", () => {
    const ids = ["/content/test", "/foo/test/1", "/content/test/2"];
    const optimizedPath = optimizeTreePath(ids);
    expect(optimizedPath).toEqual("/");
  });

  it("should find the correct base tree path", () => {
    const ids = ["/content/test", "/content/test2/1", "/content/test/2"];
    const optimizedPath = optimizeTreePath(ids);
    expect(optimizedPath).toEqual("/content");
  });

  it("should handle empty path", () => {
    const ids: string[] = [];
    const optimizedPath = optimizeTreePath(ids);
    expect(optimizedPath).toEqual(null);
  });
});
