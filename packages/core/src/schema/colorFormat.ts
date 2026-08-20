/**
 * Parsing / formatting of the CSS color strings stored by `s.color()`.
 *
 * Colors are stored as plain CSS strings so that they can be used directly in
 * `style` attributes and CSS custom properties. The schema decides which family
 * (`hex`, `rgb`, `hsl` or `oklch`) the string is written in, this module does
 * the conversion between them.
 *
 * All colors are sRGB: `oklch` is only used as an output notation, so any
 * `oklch` value that falls outside the sRGB gamut is clipped when converted
 * back to the other formats.
 */

export const COLOR_FORMATS = ["hex", "rgb", "hsl", "oklch"] as const;

export type ColorFormat = (typeof COLOR_FORMATS)[number];

export const DEFAULT_COLOR_FORMAT: ColorFormat = "hsl";

/**
 * A color, normalized to sRGB.
 *
 * `r`, `g` and `b` are 0-255 (not rounded), `a` is 0-1.
 */
export type ParsedColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

/**
 * Which color notation a string uses, or `null` if it is not a notation we
 * recognize. This looks at the syntax only: `detectColorFormat` says nothing
 * about whether the value actually parses (`hsl(nope)` is still `"hsl"`).
 */
export function detectColorFormat(value: string): ColorFormat | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith("#")) {
    return "hex";
  }
  if (trimmed.startsWith("rgb(") || trimmed.startsWith("rgba(")) {
    return "rgb";
  }
  if (trimmed.startsWith("hsl(") || trimmed.startsWith("hsla(")) {
    return "hsl";
  }
  if (trimmed.startsWith("oklch(")) {
    return "oklch";
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Splits the inside of a CSS color function into components.
 *
 * Handles both the legacy comma syntax (`rgb(1, 2, 3, 0.5)`) and the modern
 * space syntax (`rgb(1 2 3 / 0.5)`), returning the alpha (if any) separately.
 */
function splitComponents(
  args: string,
): { components: string[]; alpha: string | null } | null {
  const slashParts = args.split("/");
  if (slashParts.length > 2) {
    return null;
  }
  let alpha: string | null =
    slashParts.length === 2 ? slashParts[1].trim() : null;
  const head = slashParts[0].trim();
  if (head === "") {
    return null;
  }
  let components: string[];
  if (head.includes(",")) {
    if (alpha !== null) {
      // Mixing the comma and the slash syntax is not valid CSS
      return null;
    }
    components = head.split(",").map((part) => part.trim());
    if (components.length === 4) {
      alpha = components[3];
      components = components.slice(0, 3);
    }
  } else {
    components = head.split(/\s+/);
  }
  if (components.length !== 3 || components.some((part) => part === "")) {
    return null;
  }
  if (alpha === "") {
    return null;
  }
  return { components, alpha };
}

function parseNumber(value: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A `<number>` or a `<percentage>`, where 100% maps to `percentageBasis`.
 */
function parseNumberOrPercentage(
  value: string,
  percentageBasis: number,
): number | null {
  if (value.endsWith("%")) {
    const percentage = parseNumber(value.slice(0, -1));
    return percentage === null ? null : (percentage / 100) * percentageBasis;
  }
  return parseNumber(value);
}

function parsePercentage(value: string): number | null {
  if (!value.endsWith("%")) {
    return null;
  }
  return parseNumber(value.slice(0, -1));
}

function parseAlpha(value: string | null): number | null {
  if (value === null) {
    return 1;
  }
  if (value === "none") {
    return 0;
  }
  const parsed = parseNumberOrPercentage(value, 1);
  return parsed === null ? null : clamp(parsed, 0, 1);
}

function parseHue(value: string): number | null {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/.exec(value);
  if (!match) {
    return null;
  }
  const amount = Number(match[1]);
  switch (match[2]) {
    case "grad":
      return (amount / 400) * 360;
    case "rad":
      return (amount * 180) / Math.PI;
    case "turn":
      return amount * 360;
    default:
      return amount;
  }
}

function normalizeHue(hue: number): number {
  const wrapped = hue % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function parseHex(value: string): ParsedColor | null {
  const hex = value.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex)) {
    return null;
  }
  const expand = (char: string) => parseInt(char + char, 16);
  const pair = (index: number) => parseInt(hex.slice(index, index + 2), 16);
  if (hex.length === 3 || hex.length === 4) {
    return {
      r: expand(hex[0]),
      g: expand(hex[1]),
      b: expand(hex[2]),
      a: hex.length === 4 ? expand(hex[3]) / 255 : 1,
    };
  }
  if (hex.length === 6 || hex.length === 8) {
    return {
      r: pair(0),
      g: pair(2),
      b: pair(4),
      a: hex.length === 8 ? pair(6) / 255 : 1,
    };
  }
  return null;
}

function extractFunctionArgs(value: string, name: string): string | null {
  if (!value.startsWith(name + "(") || !value.endsWith(")")) {
    return null;
  }
  return value.slice(name.length + 1, -1);
}

function parseRgb(value: string): ParsedColor | null {
  const args =
    extractFunctionArgs(value, "rgba") ?? extractFunctionArgs(value, "rgb");
  if (args === null) {
    return null;
  }
  const split = splitComponents(args);
  if (!split) {
    return null;
  }
  const channels = split.components.map((component) =>
    component === "none" ? 0 : parseNumberOrPercentage(component, 255),
  );
  const alpha = parseAlpha(split.alpha);
  if (channels.some((channel) => channel === null) || alpha === null) {
    return null;
  }
  return {
    r: clamp(channels[0] as number, 0, 255),
    g: clamp(channels[1] as number, 0, 255),
    b: clamp(channels[2] as number, 0, 255),
    a: alpha,
  };
}

function parseHsl(value: string): ParsedColor | null {
  const args =
    extractFunctionArgs(value, "hsla") ?? extractFunctionArgs(value, "hsl");
  if (args === null) {
    return null;
  }
  const split = splitComponents(args);
  if (!split) {
    return null;
  }
  const [rawHue, rawSaturation, rawLightness] = split.components;
  const hue = rawHue === "none" ? 0 : parseHue(rawHue);
  // CSS requires percentages for s/l in hsl(), but the modern syntax also
  // allows bare numbers, so accept both.
  const saturation =
    rawSaturation === "none"
      ? 0
      : (parsePercentage(rawSaturation) ?? parseNumber(rawSaturation));
  const lightness =
    rawLightness === "none"
      ? 0
      : (parsePercentage(rawLightness) ?? parseNumber(rawLightness));
  const alpha = parseAlpha(split.alpha);
  if (
    hue === null ||
    saturation === null ||
    lightness === null ||
    alpha === null
  ) {
    return null;
  }
  return {
    ...hslToRgb(
      normalizeHue(hue),
      clamp(saturation, 0, 100),
      clamp(lightness, 0, 100),
    ),
    a: alpha,
  };
}

function parseOklch(value: string): ParsedColor | null {
  const args = extractFunctionArgs(value, "oklch");
  if (args === null) {
    return null;
  }
  const split = splitComponents(args);
  if (!split) {
    return null;
  }
  const [rawLightness, rawChroma, rawHue] = split.components;
  // Lightness is a <number> in 0-1 or a <percentage>, chroma is a <number>
  // where 0.4 is roughly the maximum, or a <percentage> where 100% = 0.4.
  const lightness =
    rawLightness === "none" ? 0 : parseNumberOrPercentage(rawLightness, 1);
  const chroma =
    rawChroma === "none" ? 0 : parseNumberOrPercentage(rawChroma, 0.4);
  const hue = rawHue === "none" ? 0 : parseHue(rawHue);
  const alpha = parseAlpha(split.alpha);
  if (lightness === null || chroma === null || hue === null || alpha === null) {
    return null;
  }
  return {
    ...oklchToRgb(
      clamp(lightness, 0, 1),
      Math.max(0, chroma),
      normalizeHue(hue),
    ),
    a: alpha,
  };
}

/**
 * Parses a CSS color string into sRGB channels.
 *
 * Accepts hex (3, 4, 6 and 8 digits), `rgb()` / `rgba()`, `hsl()` / `hsla()`
 * and `oklch()`, in both the legacy comma and the modern space syntax. Returns
 * `null` if the value is not a color we can parse - notably: named colors
 * (`red`), `color()`, `lab()` and `color-mix()` are not supported.
 */
export function parseColor(value: string): ParsedColor | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "") {
    return null;
  }
  switch (detectColorFormat(normalized)) {
    case "hex":
      return parseHex(normalized);
    case "rgb":
      return parseRgb(normalized);
    case "hsl":
      return parseHsl(normalized);
    case "oklch":
      return parseOklch(normalized);
    default:
      return null;
  }
}

/**
 * Rounds to at most `decimals` decimals, without trailing zeros.
 */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  // `|| 0` normalizes -0 to 0
  return Math.round(value * factor) / factor || 0;
}

function toHexPair(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const l = (max + min) / 2;
  if (delta === 0) {
    return { h: 0, s: 0, l: l * 100 };
  }
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === red) {
    h = ((green - blue) / delta) % 6;
  } else if (max === green) {
    h = (blue - red) / delta + 2;
  } else {
    h = (red - green) / delta + 4;
  }
  return { h: normalizeHue(h * 60), s: s * 100, l: l * 100 };
}

export function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hPrime = normalizeHue(h) / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = lightness - c / 2;
  let rgb: [number, number, number];
  if (hPrime < 1) {
    rgb = [c, x, 0];
  } else if (hPrime < 2) {
    rgb = [x, c, 0];
  } else if (hPrime < 3) {
    rgb = [0, c, x];
  } else if (hPrime < 4) {
    rgb = [0, x, c];
  } else if (hPrime < 5) {
    rgb = [x, 0, c];
  } else {
    rgb = [c, 0, x];
  }
  return {
    r: (rgb[0] + m) * 255,
    g: (rgb[1] + m) * 255,
    b: (rgb[2] + m) * 255,
  };
}

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(channel: number): number {
  const c =
    channel <= 0.0031308
      ? channel * 12.92
      : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
}

/**
 * sRGB to Oklch, using Björn Ottosson's Oklab matrices.
 */
export function rgbToOklch(
  r: number,
  g: number,
  b: number,
): { l: number; c: number; h: number } {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const long = Math.cbrt(
    0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
  );
  const medium = Math.cbrt(
    0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
  );
  const short = Math.cbrt(
    0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
  );
  const lightness =
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
  const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  const bComponent =
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;
  const chroma = Math.sqrt(a * a + bComponent * bComponent);
  // Achromatic colors have an undefined hue: report 0 rather than the noise
  // that atan2 of two near-zero numbers produces.
  const hue =
    chroma < 1e-6
      ? 0
      : normalizeHue((Math.atan2(bComponent, a) * 180) / Math.PI);
  return { l: clamp(lightness, 0, 1), c: chroma, h: hue };
}

/**
 * Oklch to sRGB. Out of gamut colors are clipped per channel.
 */
export function oklchToRgb(
  l: number,
  c: number,
  h: number,
): { r: number; g: number; b: number } {
  const hueRadians = (normalizeHue(h) * Math.PI) / 180;
  const a = c * Math.cos(hueRadians);
  const bComponent = c * Math.sin(hueRadians);
  const long = Math.pow(l + 0.3963377774 * a + 0.2158037573 * bComponent, 3);
  const medium = Math.pow(l - 0.1055613458 * a - 0.0638541728 * bComponent, 3);
  const short = Math.pow(l - 0.0894841775 * a - 1.291485548 * bComponent, 3);
  return {
    r: linearToSrgb(
      4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    ),
    g: linearToSrgb(
      -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    ),
    b: linearToSrgb(
      -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
    ),
  };
}

/**
 * Serializes a color to the canonical string of the given format.
 *
 * The modern, space separated CSS syntax is used for the color functions
 * (`rgb(255 0 0 / 0.5)`). Alpha is only included when it is not fully opaque.
 */
export function formatColor(color: ParsedColor, format: ColorFormat): string {
  const alpha = clamp(color.a, 0, 1);
  const alphaSuffix = alpha >= 1 ? "" : ` / ${round(alpha, 4)}`;
  switch (format) {
    case "hex": {
      const hex = `#${toHexPair(color.r)}${toHexPair(color.g)}${toHexPair(color.b)}`;
      return alpha >= 1 ? hex : `${hex}${toHexPair(alpha * 255)}`;
    }
    case "rgb": {
      const r = clamp(Math.round(color.r), 0, 255);
      const g = clamp(Math.round(color.g), 0, 255);
      const b = clamp(Math.round(color.b), 0, 255);
      return `rgb(${r} ${g} ${b}${alphaSuffix})`;
    }
    case "hsl": {
      const { h, s, l } = rgbToHsl(color.r, color.g, color.b);
      return `hsl(${round(h, 2)} ${round(s, 2)}% ${round(l, 2)}%${alphaSuffix})`;
    }
    case "oklch": {
      const { l, c, h } = rgbToOklch(color.r, color.g, color.b);
      return `oklch(${round(l, 4)} ${round(c, 4)} ${round(h, 2)}${alphaSuffix})`;
    }
  }
}

/**
 * Converts a color string to the canonical string of the given format, or
 * `null` if the input cannot be parsed.
 */
export function convertColor(
  value: string,
  format: ColorFormat,
): string | null {
  const parsed = parseColor(value);
  if (parsed === null) {
    return null;
  }
  return formatColor(parsed, format);
}

/**
 * `#rrggbb`, which is what `<input type="color">` uses as its value.
 */
export function colorToHex(color: ParsedColor): string {
  return `#${toHexPair(color.r)}${toHexPair(color.g)}${toHexPair(color.b)}`;
}
