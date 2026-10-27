import fs from "fs";
import path from "path";

/**
 * Every colour class the Studio writes names a token that EXISTS.
 *
 * A Tailwind class for a colour nobody defined is not an error anywhere: it
 * compiles, it ships, and the element renders in whatever colour it inherited.
 * `text-fg-quaternary` was written in six files over months — the scope trail,
 * the diff's line numbers, a block list's drag handles, a null placeholder —
 * and every one of them rendered at full strength instead of muted, because
 * `tailwind.config.js` stops at `fg-tertiary`. Nothing caught it: it typechecks,
 * it lints, and it looks like a colour.
 *
 * So the guard is this, and it has to live in a test rather than in review.
 *
 * Scoped to the design system's own token families (`fg-`, `bg-`, `border-`),
 * because those are the ones spelled from a ramp and therefore the ones a
 * plausible-looking name can be invented for. Tailwind's built-in palette
 * (`text-white`, `bg-black/50`) is deliberately not checked — it is not ours to
 * hold a list of.
 *
 * There is no allowlist, deliberately. `fg-quaternary` was the name that
 * prompted this, and the test found three more the same day — `fg-error` and
 * `fg-warning` (error and warning ink on an ordinary surface, now
 * `fg-error-on-surface` and `fg-warning-primary`, both held to AA by
 * `contrast.test.ts`) and `bg-warning` (a banner's fill, now
 * `bg-warning-primary`). A list of known-bad names is a list nobody reads and
 * everybody appends to; every one of them was fixed instead.
 */

const CONFIG = fs.readFileSync(
  path.join(__dirname, "..", "tailwind.config.js"),
  "utf8",
);

/** The keys of the `colors` map, which is what a class name has to name. */
function declaredTokens(): Set<string> {
  const start = CONFIG.indexOf("colors: {");
  if (start === -1) throw new Error("No `colors` map in tailwind.config.js");
  const tokens = new Set<string>();
  // One `"name": "var(--name)"` entry per line, which is how the map is
  // written; a rewrite that changes that will fail loudly here rather than
  // quietly stop checking.
  for (const match of CONFIG.slice(start).matchAll(
    /"([a-z0-9-]+)":\s*"var\(/g,
  )) {
    tokens.add(match[1]);
  }
  if (tokens.size < 20) {
    throw new Error(
      `Only found ${tokens.size} colour tokens — the config's shape changed and this test stopped checking anything.`,
    );
  }
  return tokens;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      // Vendored shadcn, which `surfaceTokens.test.ts` also holds outside its
      // scope: reviving those names is the migration `index.css` defers, and
      // both guards hold the line at the code we wrote.
      if (
        path.relative(__dirname, full) ===
        path.join("components", "designSystem")
      ) {
        continue;
      }
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * `text-fg-secondary-alt`, `bg-bg-float-raised`, `hover:border-border-focus`,
 * `group-hover:text-fg-primary`. The utility prefix is dropped and the token
 * is what is left.
 */
const TOKEN_CLASS =
  /(?:^|[\s"'`{([])(?:[a-z-]+:)*(?:text|bg|border|fill|stroke|ring|divide|outline|decoration|shadow|accent|caret|from|via|to)-((?:fg|bg|border)-[a-z0-9-]+)/g;

describe("colour tokens", () => {
  const tokens = declaredTokens();
  const files = sourceFiles(__dirname);

  test("the config has the tokens this test is about", () => {
    expect(tokens.has("fg-primary")).toBe(true);
    expect(tokens.has("fg-secondary-alt")).toBe(true);
    // The one that was never there. If it is added on purpose, delete this.
    expect(tokens.has("fg-quaternary")).toBe(false);
  });

  test("every fg-/bg-/border- class names a declared token", () => {
    const unknown: string[] = [];
    for (const file of files) {
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(TOKEN_CLASS)) {
        const token = match[1];
        if (!tokens.has(token)) {
          unknown.push(`${path.relative(__dirname, file)}: ${token}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });
});
