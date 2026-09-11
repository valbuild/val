import fs from "fs";
import path from "path";
import { themeCustomProperties } from "@valbuild/shared/internal";

/**
 * Every token that depends on the brand ramp has to be reachable by an accent.
 *
 * This exists because of a bug that looked impossible from the code. A themed
 * accent works by overriding `--colors-brand-green-100` … `-1000` as custom
 * properties on the element that carries `data-mode`, and letting the
 * stylesheet's own tokens re-derive from them. `index.css` says
 *
 *     --bg-page-selection: var(--colors-brand-green-600);
 *
 * which reads as "follows the ramp" and does not, because **a `var()` inside a
 * custom property is substituted where the property is DECLARED, not where it
 * is used.** That declaration is in the light block, selected by
 * `:host, :root, *[data-mode="light"]`. On a `data-mode="dark"` element none of
 * those match, so nothing is declared on it and it inherits from `:host` the
 * value already substituted — green. The override sits on the element and
 * cannot reach back into a substitution that happened on an ancestor.
 *
 * The brand tokens escape it by accident of the theme: the DARK block
 * re-declares `--bg-brand-primary: var(--colors-brand-green-800)`, and that
 * declaration IS computed on the themed element, so it resolves against the
 * override. Which is why the Studio's chrome went violet while the outlines the
 * canvas draws on the page stayed green — and only in dark mode.
 *
 * So the rule, and it is not obvious enough to leave to memory:
 *
 * **A token whose value depends on the ramp must either be re-declared in the
 * dark block, or be written explicitly by `themeCustomProperties`.**
 *
 * Nothing in the CSS or the TypeScript makes that true on its own, so this test
 * derives the list from the stylesheet and checks it. A new token declared once
 * outside the mode blocks and pointed at the ramp fails here rather than
 * shipping as "the accent does not apply to that bit".
 */

const CSS = fs.readFileSync(path.join(__dirname, "index.css"), "utf8");

/** Declarations from one `@layer base` block, as `--name: value` pairs. */
function readBlock(selector: string): Map<string, string> {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`No block for selector ${selector}`);
  const open = CSS.indexOf("{", start);
  const end = CSS.indexOf("\n  }", open);
  const body = CSS.slice(open + 1, end);
  const decls = new Map<string, string>();
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
    if (match) decls.set(match[1], match[2].trim());
  }
  return decls;
}

const LIGHT = readBlock('*[data-mode="light"]');
const DARK = readBlock('*[data-mode="dark"]');

const RAMP = /^--colors-brand-green-\d+$/;

/** Whether a token's value chain reaches the brand ramp. */
function dependsOnRamp(token: string, seen = new Set<string>()): boolean {
  if (RAMP.test(token)) return true;
  if (seen.has(token)) return false;
  seen.add(token);
  const value = LIGHT.get(token);
  if (value === undefined) return false;
  const referenced = [...value.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]);
  return referenced.some((next) => dependsOnRamp(next, seen));
}

/**
 * Tokens that depend on the ramp and are deliberately NOT themeable.
 *
 * One, and it is a rule with a document behind it: the Val mark is always Val's
 * green, in both themes and under any accent (`architecture/logo.md`). It is a
 * copy of green-400 rather than a `var()` into it for exactly this reason, so it
 * does not actually depend on the ramp — it is listed in case someone turns it
 * back into a `var()`, which would silently make the mark themeable again.
 */
const DELIBERATELY_FIXED = new Set(["--brand-val-green"]);

const rampDependent = [...LIGHT.keys()].filter(
  (token) => !RAMP.test(token) && dependsOnRamp(token),
);

/** What an accent actually writes onto the element. */
const WRITTEN = new Set(
  Object.keys(themeCustomProperties({ accent: "#2563eb" })),
);

describe("tokens that depend on the brand ramp", () => {
  test("the stylesheet still has some, so this test is not vacuous", () => {
    // If the ramp is ever renamed, every check below would pass by matching
    // nothing at all.
    expect(rampDependent.length).toBeGreaterThan(5);
  });

  test("each of them is reachable by an accent", () => {
    /*
     * Collected rather than asserted one at a time, because the failure has to
     * carry its own fix: a token that fails here LOOKS like it follows the
     * ramp, and reading the CSS agrees with that reading. A bare "expected true
     * to be false" would send the next person to the wrong place.
     */
    const unreachable = rampDependent
      .filter((token) => !DELIBERATELY_FIXED.has(token))
      .filter((token) => !DARK.has(token) && !WRITTEN.has(token))
      .map(
        (token) =>
          `${token} depends on the brand ramp but is neither re-declared under ` +
          `*[data-mode="dark"] nor written by themeCustomProperties, so a themed ` +
          `accent cannot reach it in dark mode. Re-declare it in the dark block, ` +
          `or write it in themeCustomProperties.`,
      );
    expect(unreachable).toEqual([]);
  });

  test("the page-selection tokens are all written, not left to var()", () => {
    // The three this test was written for. They are declared once and never
    // flipped with the theme — the page underneath is the customer's, not a Val
    // surface — which is precisely what puts them outside the per-mode
    // re-declaration that saves the rest.
    for (const token of [
      "--bg-page-selection",
      "--bg-page-selection-fill",
      "--bg-page-selection-soft",
    ]) {
      expect(WRITTEN.has(token)).toBe(true);
      expect(DARK.has(token)).toBe(false);
    }
  });

  test("an accent moves the outline drawn on the customer's page", () => {
    const green = themeCustomProperties({ accent: null });
    const violet = themeCustomProperties({ accent: "#7c3aed" });
    expect(green["--bg-page-selection"]).toBeUndefined();
    expect(violet["--bg-page-selection"]).toMatch(/^#[0-9a-f]{6}$/);
    // And the two tints are the same colour at lower alpha, so the resting
    // outline, the hover outline and the fill cannot disagree.
    const hex = violet["--bg-page-selection"];
    const channels = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .join(", ");
    expect(violet["--bg-page-selection-fill"]).toBe(`rgba(${channels}, 0.12)`);
    expect(violet["--bg-page-selection-soft"]).toBe(`rgba(${channels}, 0.4)`);
  });
});
