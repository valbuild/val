import { siblingOfApp } from "./siblingOfApp";

describe("a chunk's relative import, from the app served at /{VERSION}/app", () => {
  const files = new Set([
    "/assets/index-abc.js",
    "/assets/__vite-browser-external-BvK82WY9.js",
    "/assets/valbuild-tanstack-build.esm-D1CckGmG.js",
  ]);
  const has = (key: string) => files.has(key);

  test("resolves to the emitted asset beside the main chunk", () => {
    expect(
      siblingOfApp(
        "/0.137.0/__vite-browser-external-BvK82WY9.js",
        "0.137.0",
        has,
      ),
    ).toBe("/assets/__vite-browser-external-BvK82WY9.js");
    expect(
      siblingOfApp(
        "/0.137.0/valbuild-tanstack-build.esm-D1CckGmG.js",
        "0.137.0",
        has,
      ),
    ).toBe("/assets/valbuild-tanstack-build.esm-D1CckGmG.js");
  });

  test("is nothing for a name that was never emitted", () => {
    expect(siblingOfApp("/0.137.0/nope.js", "0.137.0", has)).toBeNull();
  });

  test("is nothing under another version, or with no version", () => {
    expect(
      siblingOfApp(
        "/0.136.0/__vite-browser-external-BvK82WY9.js",
        "0.137.0",
        has,
      ),
    ).toBeNull();
    expect(
      siblingOfApp("/__vite-browser-external-BvK82WY9.js", "", has),
    ).toBeNull();
  });

  test("does not walk into other directories", () => {
    expect(
      siblingOfApp("/0.137.0/assets/index-abc.js", "0.137.0", has),
    ).toBeNull();
    expect(
      siblingOfApp("/0.137.0/../assets/index-abc.js", "0.137.0", has),
    ).toBeNull();
    expect(siblingOfApp("/0.137.0/", "0.137.0", has)).toBeNull();
  });
});
