/**
 * Color normalization for svg import.
 *
 * Design tools emit the same color in many spellings (`#FFF`, `#ffffff`,
 * `rgb(255,255,255)`, `white`). To match a pasted color against a schema's
 * declared variables we reduce every spelling to a single canonical form.
 */

export type Rgb = { r: number; g: number; b: number; a: number };

/**
 * The subset of the CSS named colors that actually turns up in exported svg.
 * Deliberately not the full 148: anything missing simply fails to normalize and
 * is reported as unmatched, which is a safe outcome.
 */
const NAMED_COLORS: Readonly<Record<string, string>> = {
  aqua: "#00ffff",
  black: "#000000",
  blue: "#0000ff",
  cyan: "#00ffff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  green: "#008000",
  grey: "#808080",
  lime: "#00ff00",
  magenta: "#ff00ff",
  maroon: "#800000",
  navy: "#000080",
  olive: "#808000",
  orange: "#ffa500",
  purple: "#800080",
  red: "#ff0000",
  silver: "#c0c0c0",
  teal: "#008080",
  white: "#ffffff",
  yellow: "#ffff00",
};

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function hex2(n: number): string {
  return clamp255(n).toString(16).padStart(2, "0");
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

/**
 * Parses a CSS color into rgba components, or returns null if the spelling is
 * not one we understand.
 */
export function parseColor(input: string): Rgb | null {
  const value = input.trim();
  if (!value) {
    return null;
  }
  const lower = value.toLowerCase();
  if (lower in NAMED_COLORS) {
    return parseColor(NAMED_COLORS[lower]);
  }
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      return null;
    }
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split("");
      return {
        r: parseInt(r + r, 16),
        g: parseInt(g + g, 16),
        b: parseInt(b + b, 16),
        a: a === undefined ? 1 : parseInt(a + a, 16) / 255,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/i.exec(value);
  if (!fn) {
    return null;
  }
  const name = fn[1].toLowerCase();
  const parts = fn[2]
    .split(/[\s,/]+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length < 3) {
    return null;
  }
  const num = (raw: string, scale: number): number | null => {
    if (raw.endsWith("%")) {
      const n = Number(raw.slice(0, -1));
      return Number.isFinite(n) ? (n / 100) * scale : null;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const alpha = parts.length > 3 ? num(parts[3], 1) : 1;
  if (alpha === null) {
    return null;
  }
  if (name === "rgb" || name === "rgba") {
    const r = num(parts[0], 255);
    const g = num(parts[1], 255);
    const b = num(parts[2], 255);
    if (r === null || g === null || b === null) {
      return null;
    }
    return { r, g, b, a: alpha };
  }
  const h = num(parts[0], 360);
  const s = num(parts[1], 1);
  const l = num(parts[2], 1);
  if (h === null || s === null || l === null) {
    return null;
  }
  const [r, g, b] = hslToRgb(
    h,
    Math.max(0, Math.min(1, s)),
    Math.max(0, Math.min(1, l)),
  );
  return { r, g, b, a: alpha };
}

/**
 * Reduces a color to a canonical `#rrggbb` (or `#rrggbbaa`) string.
 * Returns null for spellings we do not understand, and for the keywords, which
 * callers handle separately.
 */
export function normalizeColor(input: string): string | null {
  const rgb = parseColor(input);
  if (!rgb) {
    return null;
  }
  const base = `#${hex2(rgb.r)}${hex2(rgb.g)}${hex2(rgb.b)}`;
  return rgb.a >= 1 ? base : `${base}${hex2(rgb.a * 255)}`;
}

/**
 * Normalized RGB distance in 0..1, used for `tolerance` matching.
 * Plain euclidean distance in sRGB: crude, but predictable, and only ever
 * applied when a variable explicitly opts in.
 */
export function colorDistance(a: string, b: string): number | null {
  const left = parseColor(a);
  const right = parseColor(b);
  if (!left || !right) {
    return null;
  }
  const dr = (left.r - right.r) / 255;
  const dg = (left.g - right.g) / 255;
  const db = (left.b - right.b) / 255;
  return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
}
