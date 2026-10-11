import { expandCssImports, type CssImportContext } from "./cssImports";

/**
 * `@import` inside a stylesheet, which the CSS pass used to hand to Tailwind
 * unresolved -- so the most ordinary Tailwind v4 layout, an entry sheet that
 * imports Tailwind, the theme and the fonts, could not be published:
 *
 *   Tailwind asked for './theme/theme.css', which this build does not carry.
 */
const context = (
  files: Record<string, string>,
  dependencyCss: Record<string, string> = {},
): CssImportContext => ({
  files,
  dependencyCss,
  seen: new Set(["src/styles.css"]),
  warnings: [],
});

const expand = (ctx: CssImportContext) =>
  expandCssImports("src/styles.css", ctx.files["src/styles.css"]!, ctx);

test("a relative import is inlined where it was, and tailwindcss is left for Tailwind", () => {
  const ctx = context({
    "src/styles.css": `@import "tailwindcss";\n@import "./theme/theme.css";\nbody { color: red; }`,
    "src/theme/theme.css": `@theme { --color-brand: blue; }`,
  });
  const out = expand(ctx);
  expect(out).toContain(`@import "tailwindcss";`);
  expect(out).not.toContain("theme.css");
  expect(out.indexOf("--color-brand")).toBeLessThan(out.indexOf("body {"));
  expect(ctx.warnings).toEqual([]);
});

test("imports nest, relative to the sheet that wrote them", () => {
  const ctx = context({
    "src/styles.css": `@import "./theme/theme.css";`,
    "src/theme/theme.css": `@import "../fonts/fonts.css";\n.theme {}`,
    "src/fonts/fonts.css": `.fonts {}`,
  });
  const out = expand(ctx);
  expect(out.indexOf(".fonts")).toBeLessThan(out.indexOf(".theme"));
});

test("a bare import is a dependency's stylesheet, carried across with the layer", () => {
  const ctx = context(
    { "src/styles.css": `@import "@fontsource-variable/inter";` },
    {
      "@fontsource-variable/inter": `@font-face { src: url(/_app/a/abc.woff2); }`,
    },
  );
  expect(expand(ctx)).toContain("url(/_app/a/abc.woff2)");
  expect(ctx.warnings).toEqual([]);
});

test("a sheet imported twice is emitted once", () => {
  const ctx = context(
    {
      "src/styles.css": `@import "./a.css";\n@import "./b.css";`,
      "src/a.css": `@import "font";\n.a {}`,
      "src/b.css": `@import "font";\n@import "./a.css";\n.b {}`,
    },
    { font: `@font-face { font-family: X; }` },
  );
  const out = expand(ctx);
  expect(out.match(/@font-face/g)).toHaveLength(1);
  expect(out.match(/\.a \{\}/g)).toHaveLength(1);
});

test("an import's layer, supports and media conditions survive as blocks", () => {
  const ctx = context({
    "src/styles.css": `@import "./a.css" layer(base) supports(display: grid) screen and (min-width: 1px);\n@import "./b.css" layer;`,
    "src/a.css": `.a {}`,
    "src/b.css": `.b {}`,
  });
  const out = expand(ctx).replace(/\s+/g, " ");
  expect(out).toContain(
    "@media screen and (min-width: 1px) { @supports (display: grid) { @layer base { .a {} } } }",
  );
  expect(out).toContain("@layer { .b {} }");
});

test("comments, URLs and unquoted url() are left alone", () => {
  const css = [
    `/* @import "./not-real.css"; */`,
    `@import "https://fonts.googleapis.com/css2?family=Inter";`,
    `@import url(plain.css);`,
  ].join("\n");
  const ctx = context({ "src/styles.css": css });
  expect(expand(ctx)).toBe(css);
  expect(ctx.warnings).toEqual([]);
});

test("what cannot be found is dropped and named, not handed to Tailwind to fail on", () => {
  const ctx = context({
    "src/styles.css": `@import "./missing.css";\n@import "@scope/not-a-dependency/x.css";\n.kept {}`,
  });
  const out = expand(ctx);
  expect(out).not.toContain("@import");
  expect(out).toContain(".kept {}");
  expect(ctx.warnings).toEqual([
    expect.stringContaining("there is no 'src/missing.css'"),
    expect.stringContaining(
      "Is '@scope/not-a-dependency' in package.json's dependencies?",
    ),
  ]);
});
