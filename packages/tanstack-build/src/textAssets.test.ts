import { withTextAssets } from "./assets";

/**
 * An asset written as text -- an SVG the Studio's code tools wrote, which
 * reach the build in `files` because everything they write is text -- is an
 * asset all the same: `import logo from "./logo.svg"` is its URL, not its
 * source parsed as code. K23 in `e2e/proposal/codeModeCases.ts`.
 */
describe("an asset written as text", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>`;

  test("goes to the build as an asset, its bytes as written", () => {
    const moved = withTextAssets({
      files: { "src/logo.svg": svg, "src/app.tsx": "export default 1;" },
      assets: {},
    });
    expect(Object.keys(moved.files)).toEqual(["src/app.tsx"]);
    expect(Object.keys(moved.assets)).toEqual(["src/logo.svg"]);
    expect(
      new TextDecoder().decode(
        Uint8Array.from(atob(moved.assets["src/logo.svg"] ?? ""), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ).toBe(svg);
  });

  test("an asset given as bytes wins over the same path as text", () => {
    const moved = withTextAssets({
      files: { "src/logo.svg": svg },
      assets: { "src/logo.svg": "AAAA" },
    });
    expect(moved.assets["src/logo.svg"]).toBe("AAAA");
  });

  test("text that is any language it builds stays source", () => {
    const moved = withTextAssets({
      files: {
        "src/a.tsx": "x",
        "src/b.css": "x",
        "src/c.json": "{}",
        "src/d.md": "x",
      },
      assets: {},
    });
    expect(Object.keys(moved.files)).toEqual([
      "src/a.tsx",
      "src/b.css",
      "src/c.json",
      "src/d.md",
    ]);
    expect(moved.assets).toEqual({});
  });

  test("non-ASCII text survives the trip", () => {
    const moved = withTextAssets({
      files: { "src/note.txt": "Blåbærsyltetøy ✓" },
      assets: {},
    });
    const back = new TextDecoder().decode(
      Uint8Array.from(atob(moved.assets["src/note.txt"] ?? ""), (c) =>
        c.charCodeAt(0),
      ),
    );
    expect(back).toBe("Blåbærsyltetøy ✓");
  });
});
