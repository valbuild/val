import {
  isAllowedSvgAttr,
  isSvgTag,
  parseSvgViewBox,
  svgVariableValue,
  SvgNode,
  SvgOptions,
  SvgSource,
  SvgTag,
  SvgVariable,
  SVG_COLOR_ATTRS,
  SVG_DEFAULT_MAX_DEPTH,
  SVG_DEFAULT_MAX_NODES,
  SVG_ENUM_ATTRS,
  SVG_KEYWORD_COLORS,
  SVG_NUMBER_ATTRS,
  SVG_STRING_ATTRS,
} from "@valbuild/core";
import { colorDistance, normalizeColor } from "./colors";
import { parseXml, XmlElement } from "./xml";

/** A literal color that could not be mapped onto a declared variable. */
export type SvgUnmatchedColor = {
  /** The color exactly as it appeared in the markup. */
  raw: string;
  /** Canonical `#rrggbb` form, when we could parse it. */
  normalized: string | null;
  /** How many attributes used it. */
  count: number;
};

/** An attribute that was dropped because the allowlist does not include it. */
export type SvgDroppedAttr = {
  tag: string;
  attr: string;
};

export type ParseSvgResult<O extends SvgOptions> =
  | {
      status: "success";
      source: SvgSource<O>;
      /** Literal colors with no home. The editor prompts for these. */
      unmatched: SvgUnmatchedColor[];
      /** Tags removed by the allowlist. */
      droppedTags: string[];
      /** Attributes removed by the allowlist. */
      droppedAttrs: SvgDroppedAttr[];
    }
  | { status: "error"; message: string };

/**
 * How a literal color should be resolved, when the caller has already made a
 * decision for it (the editor's unmatched-color prompt).
 */
export type SvgColorOverride =
  | { type: "var"; var: string }
  | { type: "keyword"; keyword: "currentColor" | "none" | "transparent" }
  | { type: "literal" };

export type ParseSvgOptions = {
  /** Keyed by the *normalized* color, or by the raw string if unparseable. */
  overrides?: Record<string, SvgColorOverride>;
};

type VariableEntry = {
  name: string;
  normalized: string | null;
  keyword: string | null;
  matches: (string | null)[];
  tolerance: number;
};

function variableEntries(options: SvgOptions): VariableEntry[] {
  return Object.entries(options.variables ?? {}).map(([name, variable]) => {
    const spec: SvgVariable = variable;
    const value = svgVariableValue(spec);
    const extra = typeof spec === "string" ? [] : (spec.match ?? []);
    return {
      name,
      normalized: normalizeColor(value),
      keyword: SVG_KEYWORD_COLORS.includes(value) ? value : null,
      matches: extra.map((m) => normalizeColor(m)),
      tolerance: typeof spec === "string" ? 0 : (spec.tolerance ?? 0),
    };
  });
}

function numberOf(raw: string): number | null {
  // Strip a unit: exports commonly write width="24px".
  const value = raw.trim().replace(/px$/i, "");
  if (value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses svg markup into an {@link SvgSource}, mapping literal colors onto the
 * schema's declared variables.
 *
 * Everything outside the allowlist is dropped rather than rejected, so pasting
 * a real-world export mostly works; what was dropped is reported so the editor
 * can say so. Colors that cannot be mapped are reported too - we never guess a
 * nearest variable unless that variable opted in with `tolerance`.
 */
export function parseSvg<O extends SvgOptions>(
  markup: string,
  options: O,
  parseOptions: ParseSvgOptions = {},
): ParseSvgResult<O> {
  const parsed = parseXml(markup);
  if (parsed.status === "error") {
    return parsed;
  }
  const root = parsed.root;
  if (root.tag.toLowerCase() !== "svg") {
    return {
      status: "error",
      message: `Expected a root <svg> element, got <${root.tag}>`,
    };
  }

  const viewBoxAttr = root.attrs.viewBox ?? root.attrs.viewbox;
  const widthAttr = root.attrs.width ? numberOf(root.attrs.width) : null;
  const heightAttr = root.attrs.height ? numberOf(root.attrs.height) : null;
  let viewBox = viewBoxAttr?.trim().replace(/[\s,]+/g, " ");
  if (!viewBox && widthAttr !== null && heightAttr !== null) {
    viewBox = `0 0 ${widthAttr} ${heightAttr}`;
  }
  if (!viewBox) {
    return {
      status: "error",
      message: "The svg has no viewBox, and no width/height to derive one from",
    };
  }
  if (!parseSvgViewBox(viewBox)) {
    return { status: "error", message: `Invalid viewBox: '${viewBox}'` };
  }

  const variables = variableEntries(options);
  const literals = options.literals ?? "forbid";
  const overrides = parseOptions.overrides ?? {};
  const unmatched = new Map<string, SvgUnmatchedColor>();
  const droppedTags: string[] = [];
  const droppedAttrs: SvgDroppedAttr[] = [];
  const maxNodes = options.maxNodes ?? SVG_DEFAULT_MAX_NODES;
  const maxDepth = options.maxDepth ?? SVG_DEFAULT_MAX_DEPTH;
  let nodeCount = 0;
  let exceeded = false;

  const resolveColor = (raw: string): unknown | undefined => {
    const trimmed = raw.trim();
    // Read back the form svgToString emits, so "copy as svg" and re-paste is
    // lossless rather than silently dropping every variable.
    const varRef = /^var\(\s*--val-svg-([a-zA-Z0-9_-]+)\s*(?:,[^)]*)?\)$/.exec(
      trimmed,
    );
    if (varRef) {
      const name = varRef[1];
      if (variables.some((v) => v.name === name)) {
        return { var: name };
      }
    }
    const keyword = SVG_KEYWORD_COLORS.find(
      (k) => k.toLowerCase() === trimmed.toLowerCase(),
    );
    if (keyword) {
      return keyword;
    }
    const normalized = normalizeColor(trimmed);
    const key = normalized ?? trimmed;
    const override = overrides[key];
    if (override) {
      if (override.type === "var") {
        return { var: override.var };
      }
      if (override.type === "keyword") {
        return override.keyword;
      }
      return normalized ?? trimmed;
    }
    if (normalized) {
      const exact = variables.find(
        (v) =>
          v.normalized === normalized ||
          v.matches.includes(normalized) ||
          (v.keyword !== null &&
            v.keyword.toLowerCase() === trimmed.toLowerCase()),
      );
      if (exact) {
        return { var: exact.name };
      }
      let best: { name: string; distance: number } | null = null;
      for (const variable of variables) {
        if (variable.tolerance <= 0 || !variable.normalized) {
          continue;
        }
        const distance = colorDistance(normalized, variable.normalized);
        if (distance === null || distance > variable.tolerance) {
          continue;
        }
        if (!best || distance < best.distance) {
          best = { name: variable.name, distance };
        }
      }
      if (best) {
        return { var: best.name };
      }
    }
    const canKeepLiteral =
      literals === "allow" ||
      (Array.isArray(literals) &&
        (literals as readonly string[]).includes(normalized ?? trimmed));
    if (canKeepLiteral) {
      return normalized ?? trimmed;
    }
    const existing = unmatched.get(key);
    if (existing) {
      existing.count++;
    } else {
      unmatched.set(key, { raw: trimmed, normalized, count: 1 });
    }
    return undefined;
  };

  const convertAttrs = (
    tag: SvgTag,
    element: XmlElement,
  ): Record<string, unknown> => {
    const attrs: Record<string, unknown> = {};
    for (const [rawName, rawValue] of Object.entries(element.attrs)) {
      const name = rawName.toLowerCase();
      if (!isAllowedSvgAttr(tag, name)) {
        droppedAttrs.push({ tag, attr: rawName });
        continue;
      }
      if ((SVG_COLOR_ATTRS as readonly string[]).includes(name)) {
        const color = resolveColor(rawValue);
        if (color !== undefined) {
          attrs[name] = color;
        }
        continue;
      }
      if ((SVG_NUMBER_ATTRS as readonly string[]).includes(name)) {
        const n = numberOf(rawValue);
        if (n !== null) {
          attrs[name] = n;
        } else {
          droppedAttrs.push({ tag, attr: rawName });
        }
        continue;
      }
      if (name in SVG_ENUM_ATTRS) {
        const allowed = SVG_ENUM_ATTRS[
          name as keyof typeof SVG_ENUM_ATTRS
        ] as readonly string[];
        const value = rawValue.trim();
        if (allowed.includes(value)) {
          attrs[name] = value;
        } else {
          droppedAttrs.push({ tag, attr: rawName });
        }
        continue;
      }
      if (name in SVG_STRING_ATTRS) {
        const { pattern, maxLength } =
          SVG_STRING_ATTRS[name as keyof typeof SVG_STRING_ATTRS];
        const value = rawValue.trim();
        if (value.length <= maxLength && pattern.test(value)) {
          attrs[name] = value;
        } else {
          droppedAttrs.push({ tag, attr: rawName });
        }
        continue;
      }
      droppedAttrs.push({ tag, attr: rawName });
    }
    return attrs;
  };

  const convert = (elements: XmlElement[], depth: number): unknown[] => {
    const nodes: unknown[] = [];
    for (const element of elements) {
      const tag = element.tag.toLowerCase();
      if (!isSvgTag(tag)) {
        if (!droppedTags.includes(element.tag)) {
          droppedTags.push(element.tag);
        }
        continue;
      }
      if (depth > maxDepth) {
        exceeded = true;
        return nodes;
      }
      nodeCount++;
      if (nodeCount > maxNodes) {
        exceeded = true;
        return nodes;
      }
      nodes.push({
        tag,
        attrs: convertAttrs(tag, element),
        children: convert(element.children, depth + 1),
      });
    }
    return nodes;
  };

  const children = convert(root.children, 1);
  if (exceeded) {
    return {
      status: "error",
      message: `The svg is too large: max is ${maxNodes} nodes and ${maxDepth} levels of nesting`,
    };
  }

  const box = parseSvgViewBox(viewBox);
  const source = {
    viewBox,
    width: widthAttr ?? box?.width ?? null,
    height: heightAttr ?? box?.height ?? null,
    children: children as SvgNode<O>[],
  } as SvgSource<O>;

  return {
    status: "success",
    source,
    unmatched: Array.from(unmatched.values()),
    droppedTags,
    droppedAttrs,
  };
}
