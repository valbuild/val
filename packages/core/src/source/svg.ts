/**
 * Key that carries the {@link SourcePath} of an svg module on a resolved
 * {@link SvgSource}.
 *
 * Svg sources are deliberately excluded from stega encoding: every string in an
 * svg (`d`, `viewBox`, `points`, ...) is machine parsed, so injecting invisible
 * characters into them corrupts the icon. The path is therefore attached as an
 * ordinary, serializable field instead, which `ValSvg` reads to emit
 * `data-val-path`.
 *
 * It is injected by stega encoding only: it is never authored and never stored.
 */
export const SVG_VAL_PATH = "_valPath";

/**
 * A named color variable.
 *
 * The `value` is an *example*: it is what the editor previews, what
 * `svgVarsCss` emits as the CSS custom property, and the color that literal
 * fills / strokes are matched against when an svg is imported. The value that
 * actually renders is resolved at runtime from `--val-svg-<name>`.
 */
export type SvgVariable =
  | string
  | {
      /**
       * Example color. May be any CSS color, or `currentColor`.
       */
      value: string;
      /**
       * Additional literal colors that also map onto this variable on import.
       * Useful because exports from design tools drift (`#fff` vs `#ffffff` vs
       * a rounded `#fefefe`).
       */
      match?: readonly string[];
      /**
       * Also match colors within this normalized RGB distance (0..1).
       * `0` (the default) means exact matches only.
       */
      tolerance?: number;
      description?: string;
    };

/**
 * How permissive to be about a color that is not a variable.
 *
 * - `"forbid"` (default): a raw color is a validation error
 * - `"allow"`: any raw color passes
 * - `string[]`: only these exact raw colors pass
 *
 * `currentColor`, `none` and `transparent` are always allowed.
 */
export type SvgLiterals = "forbid" | "allow" | readonly string[];

export type SvgSizeConstraint = number | { min?: number; max?: number };

export type SvgOptions = {
  variables?: Record<string, SvgVariable>;
  literals?: SvgLiterals;
  /** Exact intrinsic width, or a range. Constrains the viewBox width. */
  width?: SvgSizeConstraint;
  /** Exact intrinsic height, or a range. Constrains the viewBox height. */
  height?: SvgSizeConstraint;
  /**
   * Constrain viewBox width / height. A number, or `"w:h"` (e.g. `"1:1"`).
   * Compared with an epsilon so float viewBoxes are not rejected.
   */
  aspectRatio?: number | `${number}:${number}`;
  /** Maximum number of nodes in the tree. Defaults to 2000. */
  maxNodes?: number;
  /** Maximum nesting depth. Defaults to 32. */
  maxDepth?: number;
};

/**
 * The widest instantiation of {@link SvgOptions}, used where the concrete
 * options are not known (unions, `SelectorSource`).
 */
export type AllSvgOptions = {
  variables: Record<string, SvgVariable>;
  literals: "allow";
  width?: SvgSizeConstraint;
  height?: SvgSizeConstraint;
  aspectRatio?: number | `${number}:${number}`;
  maxNodes?: number;
  maxDepth?: number;
};

export type SvgVariableName<O extends SvgOptions> = Extract<
  keyof NonNullable<O["variables"]>,
  string
>;

/** A reference to one of the schema's declared color variables. */
export type SvgVarRef<O extends SvgOptions> = {
  var: SvgVariableName<O>;
};

/** Colors that are always allowed, whatever `literals` is set to. */
export type SvgKeywordColor = "currentColor" | "none" | "transparent";

type LiteralColorOf<O extends SvgOptions> =
  O["literals"] extends readonly string[]
    ? O["literals"][number]
    : O["literals"] extends "allow"
      ? string
      : never;

/**
 * The value of a color attribute (`fill` / `stroke`).
 *
 * With the default `literals: "forbid"` this is a variable reference or a
 * keyword only, so a raw hex is a *type* error and not merely a validation
 * error.
 */
export type SvgColorValue<O extends SvgOptions> =
  | SvgVarRef<O>
  | SvgKeywordColor
  | LiteralColorOf<O>;

export type SvgColorAttr = "fill" | "stroke";
export type SvgNumberAttr =
  | "cx"
  | "cy"
  | "r"
  | "rx"
  | "ry"
  | "x"
  | "y"
  | "width"
  | "height"
  | "x1"
  | "y1"
  | "x2"
  | "y2"
  | "opacity"
  | "fill-opacity"
  | "stroke-opacity"
  | "stroke-width"
  | "stroke-dashoffset"
  | "stroke-miterlimit";
export type SvgStringAttr = "d" | "points" | "transform" | "stroke-dasharray";
export type SvgEnumAttrs = {
  "stroke-linecap": "butt" | "round" | "square";
  "stroke-linejoin": "miter" | "round" | "bevel";
  "fill-rule": "nonzero" | "evenodd";
  "clip-rule": "nonzero" | "evenodd";
  "vector-effect": "non-scaling-stroke";
};
export type SvgEnumAttr = keyof SvgEnumAttrs;

/**
 * The attributes an svg node may carry.
 *
 * This mapped type *is* the attribute allowlist at the type level; the runtime
 * table in `schema/svg/allowlist` mirrors it per tag.
 */
export type SvgAttrs<O extends SvgOptions> = {
  [K in SvgColorAttr]?: SvgColorValue<O>;
} & {
  [K in SvgNumberAttr]?: number;
} & {
  [K in SvgStringAttr]?: string;
} & {
  [K in SvgEnumAttr]?: SvgEnumAttrs[K];
};

export type SvgTag =
  | "g"
  | "path"
  | "circle"
  | "ellipse"
  | "rect"
  | "line"
  | "polyline"
  | "polygon";

export type SvgNode<O extends SvgOptions> = {
  tag: SvgTag;
  attrs: SvgAttrs<O>;
  children: SvgNode<O>[];
};

/**
 * An svg as defined in a ValModule.
 *
 * The root `<svg>` element is implicit: it *is* this object, which is why a
 * nested `<svg>` is unrepresentable. `viewBox` is the single authority for the
 * intrinsic box; `width` / `height` are the default rendered size.
 */
export type SvgSource<O extends SvgOptions> = {
  viewBox: string;
  width: number | null;
  height: number | null;
  children: SvgNode<O>[];
  /**
   * Injected by stega encoding, never authored and never stored.
   * See {@link SVG_VAL_PATH}.
   */
  readonly [SVG_VAL_PATH]?: string;
};

/** An svg node with the options erased, for generic traversal. */
export type GenericSvgNode = {
  tag: string;
  attrs: Record<string, string | number | { var: string }>;
  children: GenericSvgNode[];
};

/** An svg source with the options erased, for generic traversal. */
export type GenericSvgSource = {
  viewBox: string;
  width: number | null;
  height: number | null;
  children: GenericSvgNode[];
  readonly [SVG_VAL_PATH]?: string;
};

export function isSvgVarRef(value: unknown): value is { var: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "var" in value &&
    typeof (value as { var: unknown }).var === "string"
  );
}

/** Resolves the shorthand form of {@link SvgVariable} to its object form. */
export function svgVariableValue(variable: SvgVariable): string {
  return typeof variable === "string" ? variable : variable.value;
}
