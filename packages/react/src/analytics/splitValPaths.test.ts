import { Internal } from "@valbuild/core";
import { splitValPaths } from "./splitValPaths";

describe("splitValPaths", () => {
  test.each([
    '/content/page.val.ts?p="title"',
    '/content/page.val.ts?p="title",/content/page.val.ts?p="body"',
    '/content/page.val.ts?p="sections".0."title",/content/footer.val.ts',
    "/content/footer.val.ts",
  ])("agrees with core where core is right: %s", (attribute) => {
    expect(splitValPaths(attribute)).toEqual(
      Internal.splitJoinedSourcePaths(attribute),
    );
  });

  test("keeps a record key that holds a comma whole", () => {
    expect(
      splitValPaths(
        '/content/blog.val.ts?p="/blog/a,b"."title",/content/page.val.ts?p="x"',
      ),
    ).toEqual([
      '/content/blog.val.ts?p="/blog/a,b"."title"',
      '/content/page.val.ts?p="x"',
    ]);
  });

  test("keeps an escaped quote inside a key", () => {
    expect(splitValPaths('/a.val.ts?p="say \\"hi, there\\""')).toEqual([
      '/a.val.ts?p="say \\"hi, there\\""',
    ]);
  });

  test("an empty or missing attribute names nothing", () => {
    expect(splitValPaths("")).toEqual([]);
    expect(splitValPaths(null)).toEqual([]);
  });
});
