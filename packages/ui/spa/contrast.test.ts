import fs from "fs";
import path from "path";
import {
  AA_LARGE,
  AA_TEXT,
  BRAND_CONTRAST_PAIRS,
  contrastRatio,
  RAMP_STEPS,
  RampStep,
  resolvePairGround,
  VAL_GREEN_RAMP,
} from "@valbuild/shared/internal";

/**
 * Contrast guarantees for the CMS chrome.
 *
 * Val floats over someone else's site, so its own colours have to stay out of
 * the way — near-neutral greys, with the brand green, the warning yellow and
 * the error red used sparingly. That only works if the neutrals are legible
 * on their own, which is easy to break by nudging a grey one step. These
 * tests resolve the real `var()` chains out of `index.css` and hold every
 * foreground/background pair the chrome actually renders to WCAG AA.
 */

const CSS = fs.readFileSync(path.join(__dirname, "index.css"), "utf8");

type Mode = "light" | "dark";

/**
 * Declarations from one `@layer base` block, as `--name: value` pairs.
 *
 * The light block is the selector list containing `[data-mode="light"]`, the
 * dark block is `*[data-mode="dark"]`. Dark only redeclares what changes, so
 * dark resolution falls back to the light block.
 */
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

/** Resolve a token to a hex colour, following `var()` indirection. */
function resolve(token: string, mode: Mode): string {
  const seen = new Set<string>();
  let current = token;
  for (;;) {
    if (seen.has(current)) throw new Error(`Cyclic token ${token}`);
    seen.add(current);
    const value =
      (mode === "dark" ? DARK.get(current) : undefined) ?? LIGHT.get(current);
    if (value === undefined) {
      throw new Error(`Token ${current} is not declared (${mode})`);
    }
    const varMatch = value.match(/^var\((--[\w-]+)\)$/);
    if (!varMatch) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error(`Token ${current} is not a hex colour: ${value}`);
      }
      return value.toLowerCase();
    }
    current = varMatch[1];
  }
}

/**
 * The ratio maths comes from `@valbuild/shared` rather than living here.
 *
 * There used to be a copy in this file, and a themed accent needs the same
 * maths applied to a ramp that is not in this stylesheet at all — two copies of
 * a threshold is how a guarantee quietly stops being one. `AA_TEXT` and
 * `AA_LARGE` come from there for the same reason.
 */
const contrast = contrastRatio;

/** `[foreground token, background token, minimum ratio, what renders it]` */
type Pair = [string, string, number, string];

const SURFACES = [
  "--bg-canvas",
  "--bg-surface",
  "--bg-float",
  "--bg-float-raised",
];

const PAIRS: Pair[] = [
  // Body and heading text has to work on every surface the chrome uses,
  // because panels, bars and the editor all draw from the same text tokens.
  ...SURFACES.map(
    (bg): Pair => ["--fg-primary", bg, AA_TEXT, `primary text on ${bg}`],
  ),
  ...SURFACES.map(
    (bg): Pair => ["--fg-secondary", bg, AA_TEXT, `secondary text on ${bg}`],
  ),
  // Hints, counts, timestamps and source paths. Small, so still AA text.
  ...SURFACES.map(
    (bg): Pair => ["--fg-secondary-alt", bg, AA_TEXT, `muted text on ${bg}`],
  ),
  // Solid controls: Publish, the assistant's send button, a proposal's
  // primary action.
  [
    "--fg-brand-primary",
    "--bg-brand-primary",
    AA_TEXT,
    "label on a primary button",
  ],
  // The logo mark and any filled brand badge.
  [
    "--fg-brand-secondary",
    "--bg-brand-secondary",
    AA_TEXT,
    "mark on a filled brand chip",
  ],
  // Validation error counts.
  ["--fg-error-primary", "--bg-error-primary", AA_TEXT, "error badge"],
  // Error icons and inline error copy on a normal surface.
  ...SURFACES.map(
    (bg): Pair => ["--fg-error-on-surface", bg, AA_TEXT, `error text on ${bg}`],
  ),
  // Warning surfaces.
  ["--fg-warning-primary", "--bg-warning-primary", AA_TEXT, "warning banner"],
  ["--fg-warning-secondary", "--bg-warning-secondary", AA_TEXT, "warning pill"],
  // Not text. A 1px hairline is exempt from AA, but it still has to be an
  // edge you can see, and a floating panel has to read as separate from the
  // canvas behind it — otherwise the whole floating layout collapses visually.
  ["--border-float", "--bg-float", 1.5, "panel border against its panel"],
  // Where a panel meets the canvas it is the border that separates them, not
  // the fill: a quiet chrome keeps its surfaces close together on purpose, so
  // this edge is the one that has to hold up.
  ["--border-float", "--bg-canvas", 1.4, "panel edge against the canvas"],
  // Disabled text is exempt from AA too, but a disabled Publish button whose
  // label cannot be read is still a broken button.
  ["--fg-disabled", "--bg-disabled", AA_LARGE, "disabled button label"],
  // The focus ring is a UI component indicator, so AA_LARGE (3:1) is the bar.
  // It is drawn on all three surfaces a control can sit on, and it is the one
  // thing in the chrome that MUST be noticeable — a ring that blends in is the
  // same as no ring, which is what this whole token exists to fix.
  ["--border-focus", "--bg-primary", AA_LARGE, "focus ring on a field"],
  ["--border-focus", "--bg-float", AA_LARGE, "focus ring on a panel"],
  ["--border-focus", "--bg-surface", AA_LARGE, "focus ring on the canvas"],
];

describe.each<Mode>(["light", "dark"])("%s mode contrast", (mode) => {
  test.each(PAIRS)("%s on %s >= %s (%s)", (fg, bg, min) => {
    const ratio = contrast(resolve(fg, mode), resolve(bg, mode));
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min);
  });
});

describe("the selection outline drawn on the user's page", () => {
  // This one is not on a Val surface, so it cannot be checked against a Val
  // token: the page underneath is the customer's, and could be anything. The
  // honest test is that it holds up against both extremes.
  test.each([
    ["white", "#ffffff"],
    ["black", "#000000"],
  ])("is visible on a %s page", (_name, page) => {
    const ratio = contrast(resolve("--bg-page-selection", "light"), page);
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(AA_LARGE);
  });

  test("does not flip with the theme", () => {
    expect(resolve("--bg-page-selection", "light")).toBe(
      resolve("--bg-page-selection", "dark"),
    );
  });
});

describe("the brand ramp a themed accent replaces", () => {
  // `@valbuild/shared` cannot read this stylesheet, so `accentRamp` holds its
  // own copy of the green ramp and borrows its LIGHTNESS per step to build a
  // ramp for any accent. If the two drift, every generated ramp is built from a
  // lightness profile the Studio no longer uses — and nothing else would say
  // so, because both halves would keep passing their own tests.
  test.each([...RAMP_STEPS])("step %s matches index.css", (step: RampStep) => {
    expect(VAL_GREEN_RAMP[step]).toBe(
      resolve(`--colors-brand-green-${step}`, "light"),
    );
  });

  // The other half of "one table, two checks": `BRAND_CONTRAST_PAIRS` is run
  // over generated ramps in `accentRamp.test.ts`, and over Val's own green
  // here. A pair added to the table is therefore held against both, and Val's
  // green cannot be nudged past AA either.
  test.each(
    BRAND_CONTRAST_PAIRS.map(
      (pair) => [`${pair.mode} · ${pair.what}`, pair] as const,
    ),
  )("%s meets its minimum on Val's own green", (_name, pair) => {
    const fg = resolvePairGround(pair.fg, VAL_GREEN_RAMP);
    const bg = resolvePairGround(pair.bg, VAL_GREEN_RAMP);
    expect(Number(contrast(fg, bg).toFixed(2))).toBeGreaterThanOrEqual(
      pair.min,
    );
  });
});

describe.each<Mode>(["light", "dark"])("%s mode neutrality", (mode) => {
  // The chrome's surfaces must not carry a hue of their own: the user's brand
  // is the only colour that should register. Anything above a small
  // channel spread reads as tinted next to their design.
  test.each(SURFACES)("%s is near-neutral", (token) => {
    const hex = resolve(token, mode);
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const spread = Math.max(...channels) - Math.min(...channels);
    expect(spread).toBeLessThanOrEqual(6);
  });
});
