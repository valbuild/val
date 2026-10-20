import { moduleFilePathOfPathname } from "./moduleFilePathOfPathname";

describe("moduleFilePathOfPathname", () => {
  test("reads back a path with an optional segment, which the browser encodes", () => {
    const written = "/src/routes/_site.{-$locale}.index.val.ts";
    // What `location.pathname` holds after the Studio navigates to it.
    const encoded = new URL(`http://localhost/val/~${written}`).pathname.slice(
      "/val/~".length,
    );
    expect(encoded).toBe("/src/routes/_site.%7B-$locale%7D.index.val.ts");
    expect(moduleFilePathOfPathname(encoded)).toBe(written);
  });

  test("leaves a path with nothing encoded as it is", () => {
    expect(
      moduleFilePathOfPathname("/src/routes/_site.journal.$slug.val.ts"),
    ).toBe("/src/routes/_site.journal.$slug.val.ts");
  });

  test("reads back spaces and letters outside ASCII", () => {
    const written = "/content/Über uns.val.ts";
    const encoded = new URL(`http://localhost${written}`).pathname;
    expect(moduleFilePathOfPathname(encoded)).toBe(written);
  });

  test("keeps an encoded slash encoded: it is not a separator", () => {
    expect(moduleFilePathOfPathname("/content/a%2Fb.val.ts")).toBe(
      "/content/a%2Fb.val.ts",
    );
  });

  test("leaves a malformed escape as it is instead of throwing", () => {
    expect(moduleFilePathOfPathname("/content/%E0%A4%A.val.ts")).toBe(
      "/content/%E0%A4%A.val.ts",
    );
  });
});
