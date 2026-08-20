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

export type ValSvgProps<O extends SvgOptions> = {
  src: SvgSource<O>;
  /** Sets both width and height. Overridden by an explicit width / height. */
  size?: number | string;
  width?: number | string;
  height?: number | string;
  /**
   * Per-variable values, set as `--val-svg-<name>` on the root element.
   *
   * Leave this out to let the variables resolve from CSS - which is the point
   * of them. `svgVarsCss(schema)` emits the schema's example colors as a
   * stylesheet, and a `[data-theme="dark"]` block that redefines the same
   * custom properties is all dark mode needs.
   */
  vars?: Partial<Record<SvgVariableName<O>, string>>;
  className?: string;
  style?: CSSProperties;
  /**
   * Accessible name. Leave it out for decorative icons: the svg is then marked
   * `aria-hidden`, which is what a screen reader wants for an icon that sits
   * next to a label.
   */
  title?: string;
};

function colorAttrValue(value: unknown): string | null {
  if (isSvgVarRef(value)) {
    return `var(--val-svg-${value.var}, currentColor)`;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

function buildNode(node: GenericSvgNode, key: number): ReactElement | null {
  if (!node || typeof node !== "object" || typeof node.tag !== "string") {
    return null;
  }
  const props: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    if ((SVG_COLOR_ATTRS as readonly string[]).includes(name)) {
      const color = colorAttrValue(value);
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
    .map((child, i) => buildNode(child, i))
    .filter((child): child is ReactElement => child !== null);
  return React.createElement(
    node.tag,
    props,
    children.length > 0 ? children : undefined,
  );
}

/**
 * Renders an `s.svg()` source.
 *
 * The tree is turned into React elements one tag at a time - there is no
 * `dangerouslySetInnerHTML` anywhere - and colors are emitted as
 * `var(--val-svg-<name>, currentColor)` so the same icon can inherit the text
 * color, follow a dark mode stylesheet, or be overridden per usage.
 *
 * @example
 * <ValSvg src={icons.bell} size={24} />
 * <ValSvg src={icons.bell} size={24} vars={{ brand: "var(--danger)" }} title="Notifications" />
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
  const resolvedWidth = width ?? size ?? src.width ?? undefined;
  const resolvedHeight = height ?? size ?? src.height ?? undefined;
  const varStyle: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars ?? {})) {
    if (typeof value === "string") {
      varStyle[`--val-svg-${name}`] = value;
    }
  }
  const valPath = (src as { [SVG_VAL_PATH]?: string })[SVG_VAL_PATH];
  const children = (src.children ?? [])
    .map((child, i) => buildNode(child as unknown as GenericSvgNode, i))
    .filter((child): child is ReactElement => child !== null);

  return React.createElement(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: src.viewBox,
      width: resolvedWidth,
      height: resolvedHeight,
      className,
      style: { ...varStyle, ...style },
      role: title ? "img" : "presentation",
      "aria-hidden": title ? undefined : true,
      "aria-label": title,
      // Svg sources are never stega encoded, so the overlay reads the path from
      // this field instead of from encoded strings. See stegaEncode.
      "data-val-path": valPath,
    },
    title
      ? [React.createElement("title", { key: "title" }, title), ...children]
      : children,
  );
}
