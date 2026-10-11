import { execFileSync } from "child_process";
import path from "path";

/**
 * A project whose stylesheet imports its theme, whose theme imports a font
 * package, publishes -- with the theme compiled and the font files served.
 *
 * valbuild/templates' Full, Blog and Docs templates are laid out like this, and
 * none of them could be published: the CSS pass followed only what MODULES
 * import, so `@import "./theme/theme.css"` reached Tailwind unresolved, and a
 * font package was built as code and skipped. The CI half (`collectDependencyCss`
 * reading node_modules) and the builder half are both in the probe, because the
 * handover between them -- a rewritten `url()` and the file it names -- is the
 * part that can disagree.
 */
type Probe = {
  specifiers: Array<string>;
  layerDeps: Array<string>;
  assetNames: Array<string>;
  assetBase64: Array<string>;
  fontBase64: string;
  cssCode: string;
  assetFiles: Record<string, string>;
  warnings: Array<string>;
};

let probe: Probe;

beforeAll(() => {
  const out = execFileSync(
    path.join(__dirname, "..", "node_modules", ".bin", "tsx"),
    [path.join(__dirname, "__fixtures__", "stylesheetImportsProbe.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const line = out
    .trim()
    .split("\n")
    .reverse()
    .find((candidate) => candidate.startsWith("{"));
  probe = JSON.parse(line!) as Probe;
}, 300_000);

test("a package a stylesheet imports is collected as a stylesheet", () => {
  expect(probe.specifiers).toEqual(["@fontsource-variable/inter"]);
});

test("and is not built as code, where it would fail and be reported as skipped", () => {
  expect(probe.layerDeps).not.toContain("@fontsource-variable/inter");
});

test("the theme the entry sheet imports is compiled by Tailwind", () => {
  expect(probe.cssCode).toContain("--color-brand: #123456");
  expect(probe.cssCode).toMatch(
    /\.bg-brand\s*\{\s*background-color: var\(--color-brand\)/,
  );
  expect(probe.cssCode).not.toContain("@import");
  expect(probe.warnings).toEqual([]);
});

test("the font's url() points at a published asset holding the font's bytes", () => {
  expect(probe.assetNames).toHaveLength(1);
  const [name] = probe.assetNames;
  expect(name).toMatch(/^[0-9a-f]{16}\.woff2$/);
  expect(probe.assetBase64).toEqual([probe.fontBase64]);
  // Both @font-face rules -- one from an import inside the package -- point
  // at it, and the build publishes it.
  expect(
    probe.cssCode.match(new RegExp(`url\\(/_app/a/${name}\\)`, "g")),
  ).toHaveLength(2);
  expect(probe.assetFiles[name!]).toBe(probe.fontBase64);
});
