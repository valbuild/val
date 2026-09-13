/**
 * The Studio's chrome, generated from one colour.
 *
 * `s.settings()`'s `theme.accent` is a single hex, and what it has to replace is
 * a TEN-STEP RAMP: `index.css` declares `--colors-brand-green-100` through
 * `-1000` and every brand token points into it, picking different steps in light
 * and in dark (a tinted surface is step 200 in light and 800 in dark; the text
 * on it is 1000 and 100). So the accent is not a colour to place, it is a ramp
 * to build — which is also why one accent drives both modes with nothing to keep
 * in sync.
 *
 * ## Why an arbitrary hex is safe
 *
 * The obvious worry is `contrast.test.ts`, which holds every foreground /
 * background pair the chrome renders to WCAG AA. A hex typed by an editor never
 * goes near that test.
 *
 * It holds anyway, because of how the ramp is built: **green's lightness at each
 * step is reused unchanged, and only the hue moves.** WCAG relative luminance is
 * almost entirely a function of lightness, so a ramp that keeps green's L
 * profile keeps green's contrast relationships. Chroma is scaled to the accent's
 * own saturation and then reduced — never L — until each step fits sRGB.
 *
 * "Almost entirely" is doing real work in that sentence: at equal OKLCH
 * lightness a saturated yellow has a higher relative luminance than a blue, so
 * the ratios do move a little. {@link BRAND_CONTRAST_PAIRS} is the list of pairs
 * that have to survive it, and `accentRamp.test.ts` runs them over the hue
 * circle rather than trusting the argument.
 *
 * ## What is NOT generated
 *
 * With no accent set, the hand-tuned ramp in `index.css` is used as it is. This
 * module reproduces it to within a step or two, and re-deriving a value somebody
 * tuned by eye is a silent regression rather than a simplification.
 */

/** The steps `index.css` declares, smallest (lightest) first. */
export const RAMP_STEPS = [
  100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
] as const;

export type RampStep = (typeof RAMP_STEPS)[number];

export type AccentRamp = Record<RampStep, string>;

/**
 * Val's own brand ramp, and the lightness profile every generated ramp borrows.
 *
 * A copy of what `index.css` declares, because this package cannot read the UI
 * package's stylesheet — so the two are held together by a test instead:
 * `contrast.test.ts` resolves the ramp out of the real CSS and asserts it equals
 * this. If that test fails, the stylesheet moved and this did not.
 */
export const VAL_GREEN_RAMP: AccentRamp = {
  100: "#dcfae6",
  200: "#abefc6",
  300: "#75e0a7",
  400: "#47cd89",
  500: "#17b26a",
  600: "#079455",
  700: "#067647",
  800: "#085d3a",
  900: "#074d31",
  1000: "#053321",
};

/**
 * The step the accent itself becomes, and therefore the step the whole ramp's
 * chroma is scaled against.
 *
 * 500 rather than 600: it is the most saturated step in the green ramp, so an
 * accent anchored there is reproduced about as faithfully as the ramp allows,
 * and the steps either side of it stay in the same relationship to it that
 * green's do.
 */
const ANCHOR_STEP: RampStep = 500;

/**
 * The step drawn on the CUSTOMER's page, as an outline around every editable
 * element.
 *
 * 600 is the step `index.css` pins the page-selection tokens to, for a reason
 * worth keeping: it clears 3:1 against both white and black, so the outlines
 * stay visible whatever the site behind them looks like. A generated ramp
 * inherits that because it inherits green-600's lightness — and
 * `accentRamp.test.ts` checks it on both grounds rather than assuming.
 */
const PAGE_SELECTION_STEP: RampStep = 600;

// ---------------------------------------------------------------------------
// sRGB <-> OKLCH
//
// Written out rather than taken from a dependency: it is thirty lines, it runs
// on every Studio render that has an accent, and `s.color()` already carries
// its own copy of the neighbouring maths (`schema/colorFormat.ts`) for the same
// reason.
// ---------------------------------------------------------------------------

type Rgb = readonly [number, number, number];
/** OKLCH: lightness 0-1, chroma, hue in degrees. */
type Lch = readonly [number, number, number];

const HEX = /^#[0-9a-f]{6}$/i;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** `null` for anything that is not a six-digit hex. */
function hexToRgb(hex: string): Rgb | null {
  const trimmed = hex.trim();
  if (!HEX.test(trimmed)) {
    return null;
  }
  return [
    parseInt(trimmed.slice(1, 3), 16) / 255,
    parseInt(trimmed.slice(3, 5), 16) / 255,
    parseInt(trimmed.slice(5, 7), 16) / 255,
  ];
}

function rgbToHex(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, c)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function rgbToOklch(rgb: Rgb): Lch {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [okL, Math.hypot(okA, okB), (Math.atan2(okB, okA) * 180) / Math.PI];
}

function oklchToRgb(lch: Lch): Rgb {
  const okA = lch[1] * Math.cos((lch[2] * Math.PI) / 180);
  const okB = lch[1] * Math.sin((lch[2] * Math.PI) / 180);
  const l = Math.pow(lch[0] + 0.3963377774 * okA + 0.2158037573 * okB, 3);
  const m = Math.pow(lch[0] - 0.1055613458 * okA - 0.0638541728 * okB, 3);
  const s = Math.pow(lch[0] - 0.0894841775 * okA - 1.291485548 * okB, 3);
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** A hair of slack, so a colour that is exactly at the edge is not clamped. */
const GAMUT_EPSILON = 0.0005;

function inGamut(rgb: Rgb): boolean {
  return rgb.every((c) => c >= -GAMUT_EPSILON && c <= 1 + GAMUT_EPSILON);
}

/**
 * Bring a colour inside sRGB by reducing its CHROMA, never its lightness.
 *
 * That restriction is the whole reason the contrast argument holds: clipping
 * RGB channels (which is what naive conversion does) moves lightness, and a
 * step that has drifted lighter is a step whose contrast guarantee is gone.
 * Twenty-four bisections is well past single-byte precision.
 */
function clampChromaToGamut(lch: Lch): Lch {
  if (inGamut(oklchToRgb(lch))) {
    return lch;
  }
  let lo = 0;
  let hi = lch[1];
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgb([lch[0], mid, lch[2]]))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return [lch[0], lo, lch[2]];
}

const GREEN_PROFILE: { step: RampStep; lch: Lch }[] = RAMP_STEPS.map((step) => {
  const rgb = hexToRgb(VAL_GREEN_RAMP[step]);
  if (rgb === null) {
    // Unreachable: the ramp above is literal hex. Thrown rather than defaulted
    // because a broken profile would produce a plausible-looking wrong ramp.
    throw new Error(`Val's green ramp holds a non-hex value at step ${step}`);
  }
  return { step, lch: rgbToOklch(rgb) };
});

/**
 * The ten-step ramp for one accent, or `null` if it is not a six-digit hex.
 *
 * `null` rather than a fallback: the caller knows whether it is holding a value
 * an editor picked (in which case the schema already validated it) or one that
 * came out of a hand-edited settings file, and only the caller can decide
 * whether "ignore it" or "report it" is right.
 */
export function accentRamp(accent: string): AccentRamp | null {
  const rgb = hexToRgb(accent);
  if (rgb === null) {
    return null;
  }
  const [, accentChroma, accentHue] = rgbToOklch(rgb);
  const anchor = GREEN_PROFILE.find((entry) => entry.step === ANCHOR_STEP);
  if (anchor === undefined || anchor.lch[1] === 0) {
    throw new Error("Val's green ramp has no chroma at its anchor step");
  }
  const chromaScale = accentChroma / anchor.lch[1];
  const at = (step: RampStep): string => {
    const entry = GREEN_PROFILE.find((candidate) => candidate.step === step);
    if (entry === undefined) {
      throw new Error(`Val's green ramp has no step ${step}`);
    }
    // Green's lightness and chroma, the accent's hue. Green's own hue is the
    // one thing a generated ramp does not keep.
    const [lightness, chroma] = entry.lch;
    return rgbToHex(
      oklchToRgb(
        clampChromaToGamut([lightness, chroma * chromaScale, accentHue]),
      ),
    );
  };
  // Written out rather than reduced into, so the type says every step is
  // present instead of a cast saying so.
  return {
    100: at(100),
    200: at(200),
    300: at(300),
    400: at(400),
    500: at(500),
    600: at(600),
    700: at(700),
    800: at(800),
    900: at(900),
    1000: at(1000),
  };
}

/**
 * The custom properties that restyle the chrome, ready to put on a `style`
 * attribute.
 *
 * Custom properties on the element rather than a generated stylesheet: nothing
 * has to be escaped, an inline custom property beats `@layer base` without a
 * specificity fight, and a subtree that should keep the untouched palette
 * simply is not given the object. See `useValThemeStyle` for where they go —
 * every place the Studio stamps `data-mode`, because the theme travels with it.
 *
 * Empty when nothing is set, which is what makes "no theme" cost nothing.
 */
export function themeCustomProperties(theme: {
  accent?: string | null;
  /** A `--radius` length. The caller maps the named step; see `THEME_RADIUS_LENGTHS`. */
  radius?: string | null;
}): Record<string, string> {
  const properties: Record<string, string> = {};
  if (theme.accent) {
    const ramp = accentRamp(theme.accent);
    if (ramp !== null) {
      for (const step of RAMP_STEPS) {
        properties[`--colors-brand-green-${step}`] = ramp[step];
      }
      /*
       * The page-selection trio, written OUT rather than left to follow the
       * ramp — and the first of them is the one that has to be said out loud,
       * because it looks like it should follow and does not.
       *
       * `index.css` declares `--bg-page-selection: var(--colors-brand-green-600)`,
       * so overriding the ramp looks like enough. It is not: **a `var()` inside
       * a custom property is substituted where the property is DECLARED, not
       * where it is used.** That declaration lives in the light block, whose
       * selector is `:host, :root, *[data-mode="light"]` — so on a
       * `data-mode="dark"` element the rule does not match, nothing is declared
       * there, and what the element inherits from `:host` is the value already
       * substituted to green. An override of the ramp on the element cannot
       * reach backwards into it.
       *
       * The brand tokens escape this only because the DARK block re-declares
       * them: `--bg-brand-primary: var(--colors-brand-green-800)` is computed
       * on the themed element itself, so it resolves against the override. The
       * page-selection tokens are deliberately declared once and never flipped
       * with the theme (the page underneath is not a Val surface), which is
       * exactly what puts them outside that mechanism.
       *
       * So: anything that depends on the ramp and is not re-declared per mode
       * has to be written here. `brandDerivedTokens.test.ts` scans the
       * stylesheet and fails if another one appears.
       */
      properties["--bg-page-selection"] = ramp[PAGE_SELECTION_STEP];
      const selection = hexToRgb(ramp[PAGE_SELECTION_STEP]);
      if (selection !== null) {
        const channels = selection.map((c) => Math.round(c * 255)).join(", ");
        properties["--bg-page-selection-fill"] = `rgba(${channels}, 0.12)`;
        properties["--bg-page-selection-soft"] = `rgba(${channels}, 0.4)`;
      }
    }
  }
  if (theme.radius) {
    properties["--radius"] = theme.radius;
  }
  return properties;
}

/**
 * WCAG relative luminance of a six-digit hex.
 *
 * Exported so there is one implementation of the maths that decides whether a
 * theme is legible; `contrast.test.ts` had its own copy, and two copies of a
 * threshold is how a guarantee quietly stops being one.
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (rgb === null) {
    throw new Error(`Not a six-digit hex colour: ${hex}`);
  }
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two six-digit hex colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG AA for body text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text and for UI components such as a focus ring. */
export const AA_LARGE = 3;

/**
 * Where a brand pair's background comes from.
 *
 * A `RampStep` is a step of the brand ramp, so it moves with the accent. A hex
 * is a neutral surface that does not — the canvas and the floating panels are
 * grey in every theme, and a ring has to be legible against them.
 */
export type PairGround = RampStep | string;

/**
 * Every foreground / background pair the chrome renders with BRAND colours.
 *
 * The list is data rather than a test body because two different things have to
 * be held to it, and one table is the only way they can agree:
 *
 * - `accentRamp.test.ts` runs it over ramps generated across the hue circle,
 *   which is what makes an arbitrary accent safe.
 * - `contrast.test.ts` runs it over the ramp resolved out of the real
 *   `index.css`, which is what stops someone nudging Val's own green past AA.
 *
 * The neutral pairs — muted text on a panel, a hairline on the canvas — stay in
 * `contrast.test.ts`. They have nothing to do with the accent, and a theme
 * cannot move them.
 */
export const BRAND_CONTRAST_PAIRS: readonly {
  what: string;
  mode: "light" | "dark";
  fg: PairGround;
  bg: PairGround;
  min: number;
}[] = [
  // Light: `--bg-brand-primary` is step 200, with `--fg-brand-primary` (1000)
  // and `--fg-brand-primary-alt` (900) on it.
  {
    what: "fg-brand-primary on bg-brand-primary",
    mode: "light",
    fg: 1000,
    bg: 200,
    min: AA_TEXT,
  },
  {
    what: "fg-brand-primary-alt on bg-brand-primary",
    mode: "light",
    fg: 900,
    bg: 200,
    min: AA_TEXT,
  },
  // Light: `--bg-brand-secondary` is the filled step 800.
  {
    what: "fg-brand-secondary on bg-brand-secondary",
    mode: "light",
    fg: 100,
    bg: 800,
    min: AA_TEXT,
  },
  {
    what: "fg-brand-secondary-alt on bg-brand-secondary",
    mode: "light",
    fg: 200,
    bg: 800,
    min: AA_TEXT,
  },
  // Light: `--border-focus` is step 600, and it has to read on both neutral
  // surfaces a focused control can sit on.
  {
    what: "border-focus on bg-float",
    mode: "light",
    fg: 600,
    bg: "#fcfcfc",
    min: AA_LARGE,
  },
  {
    what: "border-focus on bg-canvas",
    mode: "light",
    fg: 600,
    bg: "#f4f4f5",
    min: AA_LARGE,
  },
  // The outlines drawn on the customer's own page. Not a Val surface at all,
  // which is why the grounds are pure white and pure black: the site behind
  // them can be anything.
  {
    what: "bg-page-selection on a white site",
    mode: "light",
    fg: 600,
    bg: "#ffffff",
    min: AA_LARGE,
  },
  {
    what: "bg-page-selection on a black site",
    mode: "light",
    fg: 600,
    bg: "#000000",
    min: AA_LARGE,
  },
  // Dark inverts which step is the surface and which is the text.
  {
    what: "fg-brand-primary on bg-brand-primary",
    mode: "dark",
    fg: 100,
    bg: 800,
    min: AA_TEXT,
  },
  {
    what: "fg-brand-primary-alt on bg-brand-primary",
    mode: "dark",
    fg: 200,
    bg: 800,
    min: AA_TEXT,
  },
  {
    what: "fg-brand-secondary on bg-brand-secondary",
    mode: "dark",
    fg: 1000,
    bg: 200,
    min: AA_TEXT,
  },
  {
    what: "fg-brand-secondary-alt on bg-brand-secondary",
    mode: "dark",
    fg: 900,
    bg: 200,
    min: AA_TEXT,
  },
  // Dark's focus ring lightens rather than mirroring: step 600 is nearly
  // invisible against the dark canvas.
  {
    what: "border-focus on bg-canvas",
    mode: "dark",
    fg: 400,
    bg: "#08080a",
    min: AA_LARGE,
  },
  {
    what: "border-focus on bg-float",
    mode: "dark",
    fg: 400,
    bg: "#131316",
    min: AA_LARGE,
  },
];

/** Resolve one side of a {@link BRAND_CONTRAST_PAIRS} entry against a ramp. */
export function resolvePairGround(
  ground: PairGround,
  ramp: AccentRamp,
): string {
  return typeof ground === "number" ? ramp[ground] : ground;
}
