import fs from "fs";
import path from "path";

/**
 * Every surface names a token a SHADOW ROOT can see.
 *
 * The companion to `focusRingTokens.test.ts`, for the other half of the same
 * trap. The Studio mounts inside a shadow root with `index.css` linked into it,
 * so a `:root` rule in that stylesheet matches nothing — and `.dark` never
 * matches either, because `darkMode` is `[data-mode="dark"]`. The shadcn
 * compatibility block is declared under exactly those two selectors, so
 * `--card`, `--background`, `--primary-foreground` and the rest are all
 * undefined at render time.
 *
 * In a `box-shadow` that voids the whole declaration, which is what the focus
 * ring test is about. In a BACKGROUND it degrades quietly, and quietly is the
 * problem: `background-color: hsl(var(--card))` is invalid at computed-value
 * time, so the element paints nothing and inherits whatever is behind it. A
 * card with no surface looks like a card whose surface happens to match the
 * page — right up until it is put on a different page. `bg-primary-foreground`
 * on the record list's rows was exactly that, and nobody could see it, because
 * Storybook imports `index.css` into the DOCUMENT (`.storybook/preview.tsx`)
 * where `:root` DOES match: there the same class painted the LIGHT value in
 * dark mode, a white card with white text on it.
 *
 * A gradient degrades the same quiet way. Measured in the Studio, the fade over
 * a truncated list row computed to
 * `linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0))` — every stop dropped to
 * transparent, so the element painted a fade from nothing to nothing. Pointed
 * at a live token it computes to
 * `linear-gradient(rgba(0,0,0,0), rgb(8,8,10) 50%, rgb(8,8,10))`, which is the
 * fade that was meant to be there.
 *
 * ## Scope: paint utilities, outside the vendored design system
 *
 * `bg-`, `from-`, `via-` and `to-` — the utilities that put a colour on a
 * surface. `text-` and `border-` name the same dead tokens in a handful of
 * places and are NOT covered: there the value inherits or falls back to the
 * `* { @apply border-border-primary }` base rule, which is a wrong colour
 * rather than a missing one, and repointing each is a visual change that wants
 * its own review.
 *
 * `components/designSystem/` is shadcn as it came, and is where the bulk of the
 * dead names live. Reviving those is the migration `index.css` defers; this
 * test holds the line at the code we wrote.
 */

const SPA = __dirname;
const CSS = fs.readFileSync(path.join(SPA, "index.css"), "utf8");

/** Where shadcn's compatibility block is declared — see `index.css`. */
const DEAD_SELECTORS = ["\n  :root {", "\n  .dark {"];
/** Where the Studio's own tokens are declared, which a shadow root can see. */
const LIVE_SELECTORS = ['*[data-mode="light"]', '*[data-mode="dark"]'];

/** The custom properties declared in the block a selector opens. */
function tokensIn(selector: string): Set<string> {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`No block for selector ${selector}`);
  const open = CSS.indexOf("{", start);
  const body = CSS.slice(open + 1, CSS.indexOf("\n  }", open));
  const names = new Set<string>();
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*--([\w-]+)\s*:/);
    if (match) names.add(match[1]);
  }
  return names;
}

/**
 * The token names that are declared ONLY in the dead block, without the `--`.
 *
 * Read out of the stylesheet rather than listed here, so that moving a token
 * into the `[data-mode]` blocks — reviving it — lifts the ban on it by itself.
 */
function deadTokenNames(): Set<string> {
  const live = new Set<string>();
  for (const selector of LIVE_SELECTORS) {
    for (const name of tokensIn(selector)) live.add(name);
  }
  const dead = new Set<string>();
  for (const selector of DEAD_SELECTORS) {
    for (const name of tokensIn(selector)) {
      if (!live.has(name)) dead.add(name);
    }
  }
  return dead;
}

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Vendored shadcn — see the scope note above.
        if (
          path.relative(SPA, full) === path.join("components", "designSystem")
        )
          continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
  };
  walk(SPA);
  // This file names the forbidden classes in order to look for them.
  return found.filter((f) => path.resolve(f) !== path.resolve(__filename));
}

describe("surface tokens", () => {
  const files = sourceFiles();

  test("the suite is actually looking at the source", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  test("the dead block is still dead, and still holds the names we ban", () => {
    const dead = deadTokenNames();
    // A sample rather than the whole list: the point is that the block is
    // there and unreachable, not its exact contents.
    for (const name of ["card", "background", "primary-foreground", "muted"]) {
      expect(dead.has(name)).toBe(true);
    }
    // And that nothing the Studio actually paints with got swept in.
    for (const name of ["bg-primary", "bg-secondary", "fg-primary"]) {
      expect(dead.has(name)).toBe(false);
    }
  });

  test("no background or gradient stop names a dead token", () => {
    const dead = [...deadTokenNames()].sort((a, b) => b.length - a.length);
    // Anchored at the start of a class, so `bg-bg-primary` is not read as the
    // dead `bg-primary` sitting inside it.
    const pattern = new RegExp(
      `(?:^|[\\s"'\`])((?:bg|from|via|to)-(?:${dead.join("|")}))(?![\\w-])`,
      "gm",
    );
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of fs.readFileSync(file, "utf8").matchAll(pattern)) {
        offenders.push(`${path.relative(SPA, file)}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
