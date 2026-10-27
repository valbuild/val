import fs from "fs";
import path from "path";
import {
  DEFAULT_CANVAS_SELECTION,
  DEFAULT_CANVAS_SELECTION_SOFT,
  themeCustomProperties,
  VAL_GREEN_RAMP,
} from "@valbuild/shared/internal";

/**
 * The outline colours exist in three places, and this is what holds them equal.
 *
 * The canvas draws an outline around every editable element **on the customer's
 * own page**, and that page has none of Val's stylesheet: no `:host`, no
 * tokens, nothing to inherit. So the colour cannot be a custom property there —
 * `ValCanvasBridge` writes it into a `<style>` as a literal, and the studio
 * sends the accent over the canvas protocol for it to use instead.
 *
 * Which leaves three copies of Val's own green that have to agree:
 *
 * 1. `--bg-page-selection` / `-soft` in `packages/ui/spa/index.css`, for the
 *    studio's own chrome.
 * 2. `DEFAULT_CANVAS_SELECTION` / `_SOFT` in the canvas protocol, for a page
 *    the studio has not told (an older studio, or before the first message).
 * 3. `VAL_GREEN_RAMP[600]` in the accent generator, which is where a themed
 *    accent's replacement comes from.
 *
 * Nothing makes them agree on its own. Drift shows up as a page whose resting
 * outlines are one green and whose hover outline is another — the kind of thing
 * that is noticed months later and blamed on the browser.
 */

const CSS = fs.readFileSync(path.join(__dirname, "index.css"), "utf8");

/** One declaration's value out of the light block, verbatim. */
function declared(token: string): string {
  const match = CSS.match(new RegExp(`${token}:\\s*([^;]+);`));
  if (match === null) throw new Error(`${token} is not declared in index.css`);
  return match[1].trim();
}

describe("the outline colours drawn on the customer's page", () => {
  test("the protocol's default matches the stylesheet", () => {
    // `--bg-page-selection` is `var(--colors-brand-green-600)` in the CSS, so
    // the comparison goes through the ramp — which `contrast.test.ts` holds
    // equal to the stylesheet in turn.
    expect(declared("--bg-page-selection")).toBe(
      "var(--colors-brand-green-600)",
    );
    expect(DEFAULT_CANVAS_SELECTION).toBe(VAL_GREEN_RAMP[600]);
  });

  test("the protocol's soft default matches the stylesheet", () => {
    expect(DEFAULT_CANVAS_SELECTION_SOFT).toBe(
      declared("--bg-page-selection-soft"),
    );
  });

  test("the soft default is the same colour at lower alpha", () => {
    // Two literals that could disagree in the one way nobody would look for:
    // the same alpha on a different hue.
    const channels = [1, 3, 5]
      .map((i) => parseInt(DEFAULT_CANVAS_SELECTION.slice(i, i + 2), 16))
      .join(", ");
    expect(DEFAULT_CANVAS_SELECTION_SOFT).toBe(`rgba(${channels}, 0.4)`);
  });

  test("an accent produces the pair the page is sent", () => {
    // The studio does not recompute these for the page — it reads them off the
    // same `themeStyle` the chrome uses, so the two cannot end up a shade
    // apart. This is that object having what `ValShell` looks for in it.
    const themed = themeCustomProperties({ accent: "#7c3aed" });
    expect(typeof themed["--bg-page-selection"]).toBe("string");
    expect(typeof themed["--bg-page-selection-soft"]).toBe("string");
    expect(themed["--bg-page-selection"]).not.toBe(DEFAULT_CANVAS_SELECTION);
  });

  test("no accent means the page is told nothing and keeps the default", () => {
    const unthemed = themeCustomProperties({ accent: null });
    expect(unthemed["--bg-page-selection"]).toBeUndefined();
    expect(unthemed["--bg-page-selection-soft"]).toBeUndefined();
  });
});
