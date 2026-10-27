import { readFileSync } from "node:fs";
import path from "node:path";
import {
  canvasDarkBg,
  canvasLightBg,
  floatDarkBg,
  floatLightBg,
} from "./fallbackColors";

/**
 * The fallback colours against the stylesheet they are copies of.
 *
 * These exist to paint the studio before its stylesheet loads, so they cannot
 * read the stylesheet at runtime — which means they are duplicated values, and
 * duplicated values drift. The drift is not loud: the studio flashes one colour
 * and repaints in another, which reads as a rendering quirk rather than as two
 * numbers that disagree.
 *
 * So the test reads the real stylesheet. It reaches across packages on purpose:
 * that reach IS the coupling, and a test that mocked it away would pass while
 * the colours were wrong.
 */

const CSS_PATH = path.join(__dirname, "..", "..", "ui", "spa", "index.css");

const css = readFileSync(CSS_PATH, "utf-8");

/**
 * Resolve `--name` to a hex colour.
 *
 * The tokens are two levels deep — `--bg-canvas: var(--colors-gray-...)` — and
 * each level is declared once per theme, so the light and dark blocks are
 * separated first and each half resolved on its own.
 */
function resolve(scope: string, name: string): string {
  let value: string | undefined = declaration(scope, name);
  // A couple of hops is all the stylesheet uses; the bound stops a cycle in a
  // future edit from hanging the test run.
  for (let hop = 0; hop < 5; hop++) {
    if (value === undefined) break;
    const indirect = value.match(/^var\((--[^)]+)\)$/);
    if (!indirect) return value;
    value = declaration(scope, indirect[1]);
  }
  throw new Error(`could not resolve ${name} in the ${scope} theme`);
}

function declaration(scope: string, name: string): string | undefined {
  // Last wins, as in the cascade: the dark block redeclares the light values.
  const matches = [
    ...scope.matchAll(
      new RegExp(`${name.replace(/[-]/g, "\\-")}\\s*:\\s*([^;]+);`, "g"),
    ),
  ];
  const last = matches[matches.length - 1];
  return last === undefined ? undefined : last[1].trim();
}

/**
 * The stylesheet as its two themes.
 *
 * Dark is a `[data-mode="dark"]` block, so everything before the first one is
 * the light theme and everything from it on is dark.
 */
const darkStart = css.indexOf('[data-mode="dark"]');

describe("the pre-stylesheet fallback colours", () => {
  test("the stylesheet still has a dark block to read", () => {
    // Everything below depends on this split, so it fails on its own rather
    // than as four confusing colour mismatches.
    expect(darkStart).toBeGreaterThan(-1);
  });

  const light = () => css.slice(0, darkStart);
  const dark = () => css;

  test("the studio's loading screen matches --bg-canvas", () => {
    // What replaces the loading screen is the studio's canvas, so any other
    // colour is a flash of something that is about to be repainted.
    expect(canvasDarkBg).toBe(resolve(dark(), "--bg-canvas"));
    expect(canvasLightBg).toBe(resolve(light(), "--bg-canvas"));
  });

  test("the loading pill matches --bg-float", () => {
    // The pill floats over the customer's page as a piece of Val's chrome, and
    // the chrome is float-coloured, not canvas-coloured.
    expect(floatDarkBg).toBe(resolve(dark(), "--bg-float"));
    expect(floatLightBg).toBe(resolve(light(), "--bg-float"));
  });
});
