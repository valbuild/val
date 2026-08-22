import {
  isSvgVarRef,
  GenericSvgNode,
  SvgOptions,
  SvgSource,
  SvgVariableName,
  SVG_COLOR_ATTRS,
  SVG_VAL_PATH,
} from "@valbuild/core";
import React, { CSSProperties, ReactElement } from "react";

/**
 * A color for every variable the schema declares.
 *
 * `Record` makes each key required, so adding a variable to the schema is a
 * compile error at every call site until it is given a color. This mirrors
 * `ValRichText`'s `theme`, and for the same reason: a schema change should
 * force you to revisit the places that render it, rather than silently
 * changing how they look.
 *
 * A value may be any css color - `#0055ff`, `currentColor`, or a reference to
 * one of your own design tokens such as `var(--brand-500)`. `null` means "leave
 * it to css": the attribute is emitted as `var(--val-svg-<name>, currentColor)`
 * so a stylesheet can set it.
 */
export type SvgVars<O extends SvgOptions> = Record<
  SvgVariableName<O>,
  string | null
>;

export type ValSvgProps<O extends SvgOptions> = {
  src: SvgSource<O>;
  /** Sets both width and height. Overridden by an explicit width or height. */
  size?: number | string;
  width?: number | string;
  height?: number | string;
  /**
   * A color per declared variable. Exhaustive if given at all - see
   * {@link SvgVars}. Omit it to let every variable resolve from css.
   */
  vars?: SvgVars<O>;
  className?: string;
  style?: CSSProperties;
  /**
   * Accessible name. Leave it out for decorative icons: the svg is then marked
   * `aria-hidden`, which is what a screen reader wants for an icon sitting next
   * to a label that already says the same thing.
   */
  title?: string;
};

function cssVar(name: string): string {
  return `var(--val-svg-${name}, currentColor)`;
}

function colorAttrValue(
  value: unknown,
  vars: Record<string, string | null> | undefined,
): string | null {
  if (isSvgVarRef(value)) {
    if (vars && value.var in vars) {
      return vars[value.var] ?? cssVar(value.var);
    }
    return cssVar(value.var);
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function buildNode(
  node: GenericSvgNode,
  key: number,
  vars: Record<string, string | null> | undefined,
): ReactElement | null {
  if (!node || typeof node !== "object" || typeof node.tag !== "string") {
    return null;
  }
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if ((SVG_COLOR_ATTRS as readonly string[]).includes(name)) {
      const color = colorAttrValue(value, vars);
      if (color !== null) {
        props[name] = color;
      }
      continue;
    }
    if (typeof value === "string" || typeof value === "number") {
      props[name] = value;
    }
  }
  const children = (node.children ?? [])
    .map((child, i) => buildNode(child, i, vars))
    .filter((child): child is ReactElement => child !== null);
  return React.createElement(
    node.tag,
    props,
    children.length > 0 ? children : undefined,
  );
}

/**
 * Render an svg using JSX.
 *
 * The node tree is turned into React elements one tag at a time - there is no
 * `dangerouslySetInnerHTML` - and each color resolves through the schema's
 * variables, so the same icon can inherit the surrounding text color, follow a
 * dark mode stylesheet, or be recolored for one usage.
 *
 * @example
 * const icons = useVal(iconsVal);
 * return <ValSvg src={icons.bell} size={24} />;
 *
 * @example
 * // Wire the schema's variables to your own design tokens. Every declared
 * // variable must be listed, so adding one to the schema brings you back here.
 * const icons = useVal(iconsVal);
 * return (
 *   <ValSvg
 *     src={icons.bell}
 *     size={24}
 *     title="Notifications"
 *     vars={{
 *       brand: "var(--brand-500)",
 *       line: "currentColor",
 *       surface: null, // resolves from --val-svg-surface in css
 *     }}
 *   />
 * );
 */
export function ValSvg<O extends SvgOptions>({
  src,
  size,
  width,
  height,
  vars,
  className,
  style,
  title,
}: ValSvgProps<O>): ReactElement | null {
  if (!src || typeof src !== "object") {
    return null;
  }
  const resolvedVars = vars as Record<string, string | null> | undefined;
  const resolvedWidth = width ?? size ?? src.width ?? undefined;
  const resolvedHeight = height ?? size ?? src.height ?? undefined;
  const valPath = (src as { [SVG_VAL_PATH]?: string })[SVG_VAL_PATH];
  const children = (src.children ?? [])
    .map((child, i) =>
      buildNode(child as unknown as GenericSvgNode, i, resolvedVars),
    )
    .filter((child): child is ReactElement => child !== null);

  return React.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: src.viewBox,
      width: resolvedWidth,
      height: resolvedHeight,
      className,
      style,
      role: title ? "img" : "presentation",
      "aria-hidden": title ? undefined : true,
      "aria-label": title,
      // Svg sources are never stega encoded, so the overlay reads the path from
      // this field rather than from encoded strings. See stegaEncode.
      "data-val-path": valPath,
    },
    title
      ? [React.createElement("title", { key: "title" }, title), ...children]
      : children,
  );
}
