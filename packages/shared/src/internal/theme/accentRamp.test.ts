import {
  AA_LARGE,
  accentRamp,
  BRAND_CONTRAST_PAIRS,
  contrastRatio,
  RAMP_STEPS,
  relativeLuminance,
  resolvePairGround,
  themeCustomProperties,
  VAL_GREEN_RAMP,
} from "./accentRamp";

/**
 * Accents spanning the hue circle, plus the two that look most likely to break
 * it.
 *
 * `#000000` has no chroma at all, so the whole ramp collapses to greys — which
 * is a legitimate thing for a project to want ("no colour") and the case where
 * a chroma-scaling generator could divide by nothing. `#facc15` is the other
 * end: a yellow at that lightness is nowhere near sRGB once green's chroma
 * profile is applied to it, so it exercises the gamut clamp hardest, and yellow
 * is where "contrast is a function of lightness" is least true.
 */
const ACCENTS = [
  "#17b26a", // Val's own green, as an accent someone typed
  "#2563eb", // blue
  "#4f46e5", // indigo
  "#7c3aed", // violet
  "#db2777", // pink
  "#dc2626", // red
  "#ea580c", // orange
  "#ca8a04", // amber
  "#facc15", // yellow — the gamut-clamp and luminance edge case
  "#0891b2", // cyan
  "#64748b", // slate: a project that wants the chrome quiet
  "#000000", // black: no chroma at all
];

describe("accentRamp", () => {
  test("rejects anything that is not a six-digit hex", () => {
    // The schema validates what an editor picks, so these only arrive from a
    // hand-edited settings file. `null` lets the caller decide what to do.
    for (const bad of [
      "",
      "cornflower",
      "#fff",
      "#2563e",
      "#2563ebb",
      "hsl(217 91% 60%)",
      "rgb(37 99 235)",
      "#gggggg",
    ]) {
      expect(accentRamp(bad)).toBeNull();
    }
  });

  test("accepts the hex forms that do arrive", () => {
    expect(accentRamp("#2563EB")).not.toBeNull();
    expect(accentRamp("  #2563eb  ")).not.toBeNull();
  });

  test("produces all ten steps, each a six-digit hex", () => {
    const ramp = accentRamp("#2563eb");
    expect(ramp).not.toBeNull();
    if (ramp === null) return;
    expect(
      Object.keys(ramp)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([...RAMP_STEPS]);
    for (const step of RAMP_STEPS) {
      expect(ramp[step]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("keeps green's lightness at every step", () => {
    // The load-bearing property, and the reason an arbitrary accent is safe at
    // all: contrast is almost entirely a function of lightness, so a ramp that
    // holds green's lightness holds green's contrast relationships. The
    // tolerance is for the gamut clamp, which reduces chroma and moves
    // luminance a little as a side effect — it must not move it much.
    for (const accent of ACCENTS) {
      const ramp = accentRamp(accent);
      expect(ramp).not.toBeNull();
      if (ramp === null) continue;
      for (const step of RAMP_STEPS) {
        const generated = relativeLuminance(ramp[step]);
        const green = relativeLuminance(VAL_GREEN_RAMP[step]);
        // Compared in relative luminance rather than in OKLCH lightness,
        // because relative luminance is what WCAG actually measures.
        expect(Math.abs(generated - green)).toBeLessThan(0.14);
      }
    }
  });

  test("gets lighter to darker, monotonically, like the ramp it replaces", () => {
    // A step out of order is a ramp where a "darker" token is lighter than the
    // text meant to sit on it. Nothing else would catch it: each pair below
    // would still pass while reading as a mistake.
    for (const accent of ACCENTS) {
      const ramp = accentRamp(accent);
      if (ramp === null) continue;
      const luminances = RAMP_STEPS.map((step) =>
        relativeLuminance(ramp[step]),
      );
      for (let i = 1; i < luminances.length; i++) {
        expect(luminances[i]).toBeLessThan(luminances[i - 1]);
      }
    }
  });

  test("every brand pair the chrome renders meets WCAG AA, on every accent", () => {
    // This is the test the feature rests on. `theme.accent` takes any hex, so
    // nothing validates the CHROME's legibility except this.
    const failures: string[] = [];
    for (const accent of ACCENTS) {
      const ramp = accentRamp(accent);
      expect(ramp).not.toBeNull();
      if (ramp === null) continue;
      for (const pair of BRAND_CONTRAST_PAIRS) {
        const fg = resolvePairGround(pair.fg, ramp);
        const bg = resolvePairGround(pair.bg, ramp);
        const ratio = contrastRatio(fg, bg);
        if (ratio < pair.min) {
          failures.push(
            `${accent} ${pair.mode} ${pair.what}: ${ratio.toFixed(2)} < ${pair.min}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test("the page-selection step reads on both a white and a black site", () => {
    // Called out separately from the table because it is the only pair about
    // somebody else's page rather than about Val's chrome: the canvas draws
    // these outlines over the customer's site, and the site can be anything.
    for (const accent of ACCENTS) {
      const ramp = accentRamp(accent);
      if (ramp === null) continue;
      expect(contrastRatio(ramp[600], "#ffffff")).toBeGreaterThanOrEqual(
        AA_LARGE,
      );
      expect(contrastRatio(ramp[600], "#000000")).toBeGreaterThanOrEqual(
        AA_LARGE,
      );
    }
  });

  test("a colourless accent gives a colourless ramp rather than an error", () => {
    // "No colour" is a real preference, and the arithmetic that scales chroma
    // has a zero in it for exactly this input.
    const ramp = accentRamp("#000000");
    expect(ramp).not.toBeNull();
    if (ramp === null) return;
    for (const step of RAMP_STEPS) {
      const [r, g, b] = [1, 3, 5].map((i) =>
        parseInt(ramp[step].slice(i, i + 2), 16),
      );
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });

  test("reproduces Val's own ramp closely when given Val's own green", () => {
    // Closely, not exactly — the checked-in ramp was tuned by hand. Which is
    // why nothing round-trips it: `themeCustomProperties` returns nothing at
    // all when no accent is set, so an unthemed Studio uses the hand-tuned
    // values rather than these.
    const ramp = accentRamp(VAL_GREEN_RAMP[500]);
    expect(ramp).not.toBeNull();
    if (ramp === null) return;
    expect(ramp[500]).toBe(VAL_GREEN_RAMP[500]);
    for (const step of RAMP_STEPS) {
      expect(
        Math.abs(
          relativeLuminance(ramp[step]) -
            relativeLuminance(VAL_GREEN_RAMP[step]),
        ),
      ).toBeLessThan(0.05);
    }
  });
});

describe("themeCustomProperties", () => {
  test("an unset theme costs nothing", () => {
    // The reason this matters: the object is spread onto the element that
    // carries `data-mode`, and a project with no theme should not be paying for
    // twelve custom properties that say what the stylesheet already says.
    expect(themeCustomProperties({})).toEqual({});
    expect(themeCustomProperties({ accent: null, radius: null })).toEqual({});
    expect(themeCustomProperties({ accent: "" })).toEqual({});
  });

  test("an unparseable accent is ignored, not half-applied", () => {
    // A hand-edited settings file can hold anything. Half a ramp is worse than
    // none: the tokens that did apply would be read against the ones that did
    // not.
    expect(themeCustomProperties({ accent: "cornflower" })).toEqual({});
  });

  test("writes the ramp, and the two page-selection tokens that are not var()", () => {
    const properties = themeCustomProperties({ accent: "#2563eb" });
    for (const step of RAMP_STEPS) {
      expect(properties[`--colors-brand-green-${step}`]).toMatch(
        /^#[0-9a-f]{6}$/,
      );
    }
    // `--bg-page-selection` itself is `var(--colors-brand-green-600)` in
    // index.css, so it follows the ramp on its own and must NOT be written
    // here. These two are literal rgba() and have to be derived.
    expect(properties["--bg-page-selection"]).toBeUndefined();
    expect(properties["--bg-page-selection-fill"]).toMatch(
      /^rgba\(\d+, \d+, \d+, 0\.12\)$/,
    );
    expect(properties["--bg-page-selection-soft"]).toMatch(
      /^rgba\(\d+, \d+, \d+, 0\.4\)$/,
    );
  });

  test("the page-selection tints are the ramp's own step 600", () => {
    const ramp = accentRamp("#7c3aed");
    expect(ramp).not.toBeNull();
    if (ramp === null) return;
    const properties = themeCustomProperties({ accent: "#7c3aed" });
    const channels = [1, 3, 5]
      .map((i) => parseInt(ramp[600].slice(i, i + 2), 16))
      .join(", ");
    expect(properties["--bg-page-selection-fill"]).toBe(
      `rgba(${channels}, 0.12)`,
    );
  });

  test("radius is independent of the accent", () => {
    // The two axes are set separately in the panel, so either one alone has to
    // produce a usable object.
    expect(themeCustomProperties({ radius: "0.25rem" })).toEqual({
      "--radius": "0.25rem",
    });
    const both = themeCustomProperties({ accent: "#2563eb", radius: "0rem" });
    expect(both["--radius"]).toBe("0rem");
    expect(both["--colors-brand-green-500"]).toBeDefined();
  });
});
