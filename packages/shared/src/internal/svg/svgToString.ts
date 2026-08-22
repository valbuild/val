import {
  isSvgVarRef,
  svgVariableValue,
  GenericSvgNode,
  GenericSvgSource,
  SvgOptions,
  SvgVariable,
  SVG_COLOR_ATTRS,
  SVG_VAL_PATH,
} from "@valbuild/core";
import { type JSONValue } from "@valbuild/core/patch";
import { encodeXmlText } from "./xml";

export type SvgToStringOptions = {
  /**
   * Resolve variables to concrete colors instead of `var(--val-svg-*)`.
   * Pass the schema's variables to get markup that stands on its own - which is
   * what "copy as svg" in the editor wants.
   */
  variables?: Record<string, SvgVariable>;
  /** Indent the output. Off by default. */
  pretty?: boolean;
};

function colorToAttrValue(
  value: unknown,
  variables: Record<string, SvgVariable> | undefined,
): string | null {
  if (isSvgVarRef(value)) {
    const declared = variables?.[value.var];
    if (declared !== undefined) {
      return svgVariableValue(declared);
    }
    return `var(--val-svg-${value.var}, currentColor)`;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

/**
 * Serializes an svg source back to markup.
 *
 * The inverse of `parseSvg` for everything the allowlist keeps, so the two can
 * be round-trip tested against each other.
 */
export function svgToString(
  source: GenericSvgSource,
  options: SvgToStringOptions = {},
): string {
  const { variables, pretty } = options;
  const nl = pretty ? "\n" : "";
  const pad = (depth: number) => (pretty ? "  ".repeat(depth) : "");

  const renderNode = (node: GenericSvgNode, depth: number): string => {
    const attrs: string[] = [];
    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      const rendered = (SVG_COLOR_ATTRS as readonly string[]).includes(name)
        ? colorToAttrValue(value, variables)
        : typeof value === "number"
          ? String(value)
          : typeof value === "string"
            ? value
            : null;
      if (rendered === null) {
        continue;
      }
      attrs.push(`${name}="${encodeXmlText(rendered)}"`);
    }
    const open = [node.tag, ...attrs].join(" ");
    const children = node.children ?? [];
    if (children.length === 0) {
      return `${pad(depth)}<${open}/>`;
    }
    const inner = children
      .map((child) => renderNode(child, depth + 1))
      .join(nl);
    return `${pad(depth)}<${open}>${nl}${inner}${nl}${pad(depth)}</${node.tag}>`;
  };

  const rootAttrs = [
    'xmlns="http://www.w3.org/2000/svg"',
    `viewBox="${encodeXmlText(source.viewBox)}"`,
  ];
  if (source.width !== null && source.width !== undefined) {
    rootAttrs.push(`width="${source.width}"`);
  }
  if (source.height !== null && source.height !== undefined) {
    rootAttrs.push(`height="${source.height}"`);
  }
  const children = (source.children ?? [])
    .map((child) => renderNode(child, 1))
    .join(nl);
  if (!children) {
    return `<svg ${rootAttrs.join(" ")}/>`;
  }
  return `<svg ${rootAttrs.join(" ")}>${nl}${children}${nl}</svg>`;
}

/**
 * Rebuilds an svg source as plain, mutable json.
 *
 * Patches are typed as `JSONValue`, while a source is `Json` (deeply readonly)
 * and may carry the stega-injected path field. Rebuilding is how we bridge the
 * two without a type assertion, and it drops `_valPath` on the way.
 */
export function svgSourceToJson(source: GenericSvgSource): JSONValue {
  const node = (n: GenericSvgNode): JSONValue => {
    const attrs: { [key: string]: JSONValue } = {};
    for (const [name, value] of Object.entries(n.attrs ?? {})) {
      if (typeof value === "string" || typeof value === "number") {
        attrs[name] = value;
      } else if (isSvgVarRef(value)) {
        attrs[name] = { var: value.var };
      }
    }
    return {
      tag: n.tag,
      attrs,
      children: (n.children ?? []).map(node),
    };
  };
  return {
    viewBox: source.viewBox,
    width: source.width ?? null,
    height: source.height ?? null,
    children: (source.children ?? []).map(node),
  };
}

/**
 * Strips the stega-injected path field, so a source can be compared or written
 * back to a module.
 */
export function stripSvgValPath<T extends GenericSvgSource>(source: T): T {
  if (!(SVG_VAL_PATH in source)) {
    return source;
  }
  const copy = { ...source } as Record<string, unknown>;
  delete copy[SVG_VAL_PATH];
  return copy as T;
}

/** Convenience: the variables of a schema, in the shape `svgToString` wants. */
export function svgVariablesOf(
  options: SvgOptions | undefined,
): Record<string, SvgVariable> | undefined {
  return options?.variables;
}
