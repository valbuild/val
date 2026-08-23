import fs from "fs";
import path from "path";

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

/** WCAG AA for body text. */
const AA_TEXT = 4.5;
/** WCAG AA for large text (>=18.66px bold or >=24px) and UI components. */
const AA_LARGE = 3;

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

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

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
];

describe.each<Mode>(["light", "dark"])("%s mode contrast", (mode) => {
  test.each(PAIRS)("%s on %s >= %s (%s)", (fg, bg, min) => {
    const ratio = contrast(resolve(fg, mode), resolve(bg, mode));
    expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min);
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
