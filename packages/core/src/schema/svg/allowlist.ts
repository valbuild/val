import {
  SvgColorAttr,
  SvgEnumAttr,
  SvgEnumAttrs,
  SvgNumberAttr,
  SvgStringAttr,
  SvgTag,
} from "../../source/svg";

/**
 * The svg subset Val stores and renders.
 *
 * `ValSvg` builds React elements from this tree instead of using
 * `dangerouslySetInnerHTML`, so this allowlist is the *entire* security
 * boundary. React renders unknown attributes on host elements verbatim -
 * `createElement("circle", { onload: "alert(1)" })` really does emit
 * `onload="alert(1)"`, and `onload` fires on svg elements - so this must be a
 * strict allowlist of exact attribute names per tag, never an `on*` denylist.
 */

export const SVG_TAGS: readonly SvgTag[] = [
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
];

export const SVG_COLOR_ATTRS: readonly SvgColorAttr[] = ["fill", "stroke"];

/** Attributes allowed on every tag. */
export const SVG_COMMON_ATTRS: readonly string[] = [
  "fill",
  "stroke",
  "fill-opacity",
  "stroke-opacity",
  "opacity",
  "stroke-width",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "fill-rule",
  "clip-rule",
  "vector-effect",
  "transform",
];

/** Geometry attributes, allowed only on the tag that owns them. */
export const SVG_TAG_ATTRS: Readonly<Record<SvgTag, readonly string[]>> = {
  g: [],
  path: ["d"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  rect: ["x", "y", "width", "height", "rx", "ry"],
  line: ["x1", "y1", "x2", "y2"],
  polyline: ["points"],
  polygon: ["points"],
};

export const SVG_NUMBER_ATTRS: readonly SvgNumberAttr[] = [
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x",
  "y",
  "width",
  "height",
  "x1",
  "y1",
  "x2",
  "y2",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "stroke-width",
  "stroke-dashoffset",
  "stroke-miterlimit",
];

export const SVG_ENUM_ATTRS: Readonly<{
  [K in SvgEnumAttr]: readonly SvgEnumAttrs[K][];
}> = {
  "stroke-linecap": ["butt", "round", "square"],
  "stroke-linejoin": ["miter", "round", "bevel"],
  "fill-rule": ["nonzero", "evenodd"],
  "clip-rule": ["nonzero", "evenodd"],
  "vector-effect": ["non-scaling-stroke"],
};

/**
 * The only free-form strings in the format. Each is both regex constrained and
 * length capped, so there is no unbounded attacker controlled string anywhere.
 */
export const SVG_STRING_ATTRS: Readonly<
  Record<SvgStringAttr, { pattern: RegExp; maxLength: number }>
> = {
  d: {
    pattern: /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.\-+eE]*$/,
    maxLength: 100_000,
  },
  points: { pattern: /^[\d.\s,\-+eE]*$/, maxLength: 50_000 },
  transform: { pattern: /^[a-z0-9\s(),.\-+eE]*$/i, maxLength: 512 },
  "stroke-dasharray": { pattern: /^[\d.\s,]*$/, maxLength: 512 },
};

/** Colors that are allowed whatever the schema's `literals` option is. */
export const SVG_KEYWORD_COLORS: readonly string[] = [
  "currentColor",
  "none",
  "transparent",
];

/**
 * Attribute names must look like plain svg attributes before they are handed to
 * `createElement`. This also blocks `__proto__` / `constructor` keys smuggled in
 * through `JSON.parse`.
 */
export const SVG_ATTR_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export const SVG_VIEW_BOX_PATTERN = /^-?\d+(\.\d+)?( -?\d+(\.\d+)?){3}$/;

export const SVG_DEFAULT_MAX_NODES = 2000;
export const SVG_DEFAULT_MAX_DEPTH = 32;

/**
 * Tolerance used when comparing aspect ratios, so that a viewBox with rounded
 * float dimensions is not rejected.
 */
export const SVG_ASPECT_RATIO_EPSILON = 1e-4;

export function isSvgTag(tag: string): tag is SvgTag {
  return (SVG_TAGS as readonly string[]).includes(tag);
}

export function isAllowedSvgAttr(tag: SvgTag, attr: string): boolean {
  return SVG_COMMON_ATTRS.includes(attr) || SVG_TAG_ATTRS[tag].includes(attr);
}

export function parseSvgViewBox(
  viewBox: string,
): { minX: number; minY: number; width: number; height: number } | null {
  if (!SVG_VIEW_BOX_PATTERN.test(viewBox)) {
    return null;
  }
  const [minX, minY, width, height] = viewBox.split(" ").map(Number);
  if (![minX, minY, width, height].every((n) => Number.isFinite(n))) {
    return null;
  }
  if (width < 0 || height < 0) {
    return null;
  }
  return { minX, minY, width, height };
}
