import fs from "fs";
import path from "path";

/**
 * Every focus ring must name a token a SHADOW ROOT can see.
 *
 * The Studio mounts inside a shadow root with `index.css` linked into it
 * (`App.tsx`, `Overlay.tsx`). A shadow tree's root is a DocumentFragment, so a
 * `:root` rule in that stylesheet matches nothing — and `.dark` never matches
 * either, because `darkMode` is `[data-mode="dark"]`. The shadcn compatibility
 * block is declared under exactly those two selectors, so `--ring`,
 * `--background` and `--input` are all undefined at render time.
 *
 * For most properties that degrades quietly. In a `box-shadow` it does not:
 * `hsl()` is invalid at computed-value time and takes the WHOLE declaration
 * with it, so `ring-ring` painted nothing and every focus ring in the Studio
 * was invisible. Measured in Chromium: an element carrying the old
 * `ring-2 ring-ring ring-offset-2 ring-offset-background` computes to
 * `box-shadow: none`. A stale `ring-offset-background` alone is enough to do
 * it, even at a 0px offset width — which is why the offset utilities were
 * removed rather than repointed.
 *
 * None of this was visible where the components were designed: Storybook
 * imports `index.css` into the DOCUMENT (`.storybook/preview.tsx`), where
 * `:root` does match and every ring renders correctly.
 *
 * So: focus styling names `--border-focus`, and this test is what keeps it
 * that way.
 */

const SPA = __dirname;
const CSS = fs.readFileSync(path.join(SPA, "index.css"), "utf8");

/**
 * Vendored shadcn calendars, kept as they came. Their `has-focus:` and
 * `ring-ring/50` are Tailwind v4 syntax that this v3 config does not compile
 * at all, so they are inert rather than wrong.
 */
const VENDORED = new Set([
  "components/designSystem/calendar.tsx",
  "components/designSystem/ui/calendar.tsx",
]);

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) found.push(full);
    }
  };
  walk(SPA);
  return found.filter(
    (f) =>
      !VENDORED.has(path.relative(SPA, f)) &&
      // This file names the forbidden classes in order to look for them.
      path.resolve(f) !== path.resolve(__filename),
  );
}

/** The custom properties declared in a block whose selector a shadow root matches. */
function shadowVisibleTokens(): Set<string> {
  const tokens = new Set<string>();
  for (const selector of ['*[data-mode="light"]', '*[data-mode="dark"]']) {
    const start = CSS.indexOf(selector);
    if (start === -1) throw new Error(`No block for selector ${selector}`);
    const open = CSS.indexOf("{", start);
    const body = CSS.slice(open + 1, CSS.indexOf("\n  }", open));
    for (const line of body.split("\n")) {
      const match = line.match(/^\s*(--[\w-]+)\s*:/);
      if (match) tokens.add(match[1]);
    }
  }
  return tokens;
}

describe("focus ring tokens", () => {
  const files = sourceFiles();

  test("the suite is actually looking at the source", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  test("--border-focus is declared in both themes", () => {
    const declared = shadowVisibleTokens();
    expect(declared.has("--border-focus")).toBe(true);
    // Declared per theme, not once: a ring that does not flip is invisible in
    // one of the two modes.
    for (const selector of ['*[data-mode="light"]', '*[data-mode="dark"]']) {
      const start = CSS.indexOf(selector);
      const open = CSS.indexOf("{", start);
      const body = CSS.slice(open + 1, CSS.indexOf("\n  }", open));
      expect(body).toContain("--border-focus:");
    }
  });

  test("no ring names a token from the dead :root block", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const dead of ["ring-ring", "ring-offset-background"]) {
        if (src.includes(dead)) {
          offenders.push(`${path.relative(SPA, file)}: ${dead}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no ring offset is applied without an offset colour that resolves", () => {
    // `ring-offset-*` needs a colour matching whichever surface the control
    // sits on, and controls sit on three. Rather than pick per call site, the
    // offset is not used at all — `ring-2` alone reads correctly everywhere.
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      if (/\bring-offset-\d/.test(src)) {
        offenders.push(path.relative(SPA, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every ring colour utility names a shadow-visible token", () => {
    const declared = shadowVisibleTokens();
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      for (const match of src.matchAll(/\bring-((?:border|bg|fg)-[\w-]+)/g)) {
        if (!declared.has(`--${match[1]}`)) {
          offenders.push(`${path.relative(SPA, file)}: ring-${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
