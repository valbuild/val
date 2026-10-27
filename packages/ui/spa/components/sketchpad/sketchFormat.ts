/**
 * A page sketch: a page written as indented text, with four primitives.
 *
 * ```
 * # Our people                 text (a heading: #, ## or ###)
 * We are 40 people in Oslo.    text (a paragraph)
 * [image: Team photo]          placeholder: [kind] or [kind: label]
 * [hero: Roof](image: /a.jpg)  a placeholder with an image (or video) in it
 * icon hero M3 5h18v14H3z      how every [hero] box is drawn: SVG path data
 * row                          its children side by side
 *   col 2                      its children stacked; 2 shares of the row
 *     ## Design
 *   col
 *     [button: Join us]
 * ```
 *
 * It is a scratch pad, not a layout language: it says WHAT is on a page and
 * roughly WHERE, so an assistant and a person can agree on a page's content
 * before anyone worries about how it looks. That is why it is plain text an
 * assistant can rewrite in one go, and why it never fails to parse: a line it
 * does not understand is reported and the rest of the page still renders.
 *
 * A placeholder's kind is any word, and nothing here knows what one means. The
 * assistant that writes the sketch also draws each kind's icon, as path data
 * in a 24 by 24 box, so a kind nobody thought of looks as deliberate as an
 * image. Media put in a box is written into the text too, so the assistant
 * that builds the page reads it exactly as the person left it.
 */

export type SketchNode = SketchRow | SketchCol | SketchText | SketchPlaceholder;

export type SketchRow = {
  type: "row";
  line: number;
  children: SketchNode[];
};

export type SketchCol = {
  type: "col";
  line: number;
  /** Shares of the enclosing row this column takes. */
  weight: number;
  children: SketchNode[];
};

export type SketchText = {
  type: "text";
  line: number;
  /** 0 is a paragraph; 1-3 are headings. */
  level: 0 | 1 | 2 | 3;
  text: string;
};

export type SketchPlaceholder = {
  type: "placeholder";
  line: number;
  kind: string;
  label: string | null;
  media: SketchMedia | null;
};

export type SketchMedia = {
  type: "image" | "video";
  src: string;
};

export type SketchError = {
  /** 1-based, like an editor's gutter. */
  line: number;
  message: string;
};

export type ParsedSketch = {
  /** The page itself is a column. */
  blocks: SketchNode[];
  /**
   * SVG path data by kind, lower case. Drawn as a 24 by 24 line icon: stroked
   * in the text colour, not filled.
   */
  icons: Record<string, string>;
  errors: SketchError[];
};

const CONTAINER = /^(row|col)(?:\s+(\d+))?$/;
const PLACEHOLDER =
  /^\[([^\]:]*)(?::([^\]]*))?\](?:\((image|video):\s*([^\s)]+)\s*\))?$/;
const HAS_MEDIA = /^\[[^\]]*\]\(/;
const ICON = /^icon\s+(\S+)\s+([Mm][\d\s.-].*)$/;
const PATH_DATA = /^[Mm][MmLlHhVvCcSsQqTtAaZz\d\s.,-]*$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

type Open = {
  /** The indent of the row or col line itself; -1 for the page. */
  indent: number;
  children: SketchNode[];
  /** The indent of the last block put in `children`. */
  lastIndent: number | null;
};

export function parseSketch(source: string): ParsedSketch {
  const blocks: SketchNode[] = [];
  const errors: SketchError[] = [];
  const icons: Record<string, string> = {};
  // The containers that are open at the current line, innermost last.
  const stack: Open[] = [{ indent: -1, children: blocks, lastIndent: null }];

  source.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const expanded = raw.replace(/\t/g, "  ");
    const content = expanded.trim();
    if (content === "") {
      return;
    }
    const indent = expanded.length - expanded.trimStart().length;

    // An icon is not a block, so it can go anywhere and closes nothing.
    const icon = ICON.exec(content);
    if (icon) {
      const path = icon[2].trim();
      if (PATH_DATA.test(path)) {
        icons[icon[1].toLowerCase()] = path;
      } else {
        errors.push({
          line,
          message:
            'An icon is SVG path data for a 24 by 24 box, like "icon stat M3 17l6-6 4 4 8-8". Only path commands and numbers are allowed.',
        });
      }
      return;
    }

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    const node = parseContent(content, line, errors);

    // Indented further than the block above it, and that block is not a
    // container. Keep it as that block's sibling rather than dropping it.
    if (parent.lastIndent !== null && indent > parent.lastIndent) {
      errors.push({
        line,
        message:
          "Only row and col can hold other blocks. Indent this as much as the line above it.",
      });
    } else {
      parent.lastIndent = indent;
    }
    parent.children.push(node);
    if (node.type === "row" || node.type === "col") {
      stack.push({ indent, children: node.children, lastIndent: null });
    }
  });

  return { blocks, icons, errors };
}

function parseContent(
  content: string,
  line: number,
  errors: SketchError[],
): SketchNode {
  // A leading backslash keeps a line that looks like a keyword as text.
  if (content.startsWith("\\")) {
    return { type: "text", line, level: 0, text: content.slice(1) };
  }
  const container = CONTAINER.exec(content);
  if (container) {
    if (container[1] === "row") {
      if (container[2] !== undefined) {
        errors.push({
          line,
          message: `A row takes no number. Put it on a col: "col ${container[2]}".`,
        });
      }
      return { type: "row", line, children: [] };
    }
    const weight = container[2] === undefined ? 1 : Number(container[2]);
    if (weight === 0) {
      errors.push({ line, message: "A col needs a weight of 1 or more." });
    }
    return { type: "col", line, weight: Math.max(weight, 1), children: [] };
  }
  if (content.startsWith("[")) {
    const placeholder = PLACEHOLDER.exec(content);
    if (placeholder) {
      const kind = placeholder[1].trim();
      const label = placeholder[2]?.trim();
      const mediaType = placeholder[3];
      return {
        type: "placeholder",
        line,
        kind: kind === "" ? "block" : kind,
        label: label ? label : null,
        media:
          mediaType === "image" || mediaType === "video"
            ? { type: mediaType, src: placeholder[4] }
            : null,
      };
    }
    if (HAS_MEDIA.test(content)) {
      errors.push({
        line,
        message:
          'Media in a box is written after it as (image: url) or (video: url), like "[hero: Team photo](image: /public/val/team.jpg)".',
      });
      return { type: "text", line, level: 0, text: content };
    }
    errors.push({
      line,
      message:
        'A placeholder is written [kind] or [kind: label], on a line of its own, like "[image: Team photo]".',
    });
    return { type: "text", line, level: 0, text: content };
  }
  const heading = HEADING.exec(content);
  if (heading) {
    const level = heading[1].length === 1 ? 1 : heading[1].length === 2 ? 2 : 3;
    return { type: "text", line, level, text: heading[2] };
  }
  return { type: "text", line, level: 0, text: content };
}

/**
 * The line a text block is written as. Line breaks become spaces, and a
 * paragraph that would read as something else is kept as text with `\`.
 */
export function formatText(level: SketchText["level"], text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (level > 0) {
    return "#".repeat(level) + " " + flat;
  }
  const ambiguous =
    flat.startsWith("\\") ||
    flat.startsWith("[") ||
    CONTAINER.test(flat) ||
    HEADING.test(flat) ||
    ICON.test(flat);
  return ambiguous ? "\\" + flat : flat;
}

/** The line a placeholder is written as. */
export function formatPlaceholder(
  placeholder: Pick<SketchPlaceholder, "kind" | "label" | "media">,
): string {
  const clean = (text: string) =>
    text.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
  const kind = clean(placeholder.kind).replace(/:/g, "") || "block";
  const label = placeholder.label === null ? "" : clean(placeholder.label);
  const media = placeholder.media
    ? `(${placeholder.media.type}: ${placeholder.media.src.replace(/[\s)]/g, encodeURIComponent)})`
    : "";
  return `[${kind}${label ? `: ${label}` : ""}]${media}`;
}

/** `source` with its `line` (1-based) replaced, keeping that line's indent. */
export function replaceLine(
  source: string,
  line: number,
  content: string,
): string {
  const lines = source.split("\n");
  const current = lines[line - 1];
  if (current === undefined) {
    return source;
  }
  const indent = current.slice(0, current.length - current.trimStart().length);
  lines[line - 1] = indent + content;
  return lines.join("\n");
}

/**
 * The sketch drawn as monospace text, `width` characters wide: what an
 * assistant can be handed back to see the page the way a person sees the
 * wireframe. Columns are separated by a gutter of spaces and placeholders
 * are boxes; no line of the result is longer than `width`.
 */
export function renderSketchAscii(blocks: SketchNode[], width = 72): string {
  return renderStack(blocks, Math.max(width, MIN_WIDTH))
    .map((l) => l.trimEnd())
    .join("\n");
}

const MIN_WIDTH = 8;
const GUTTER = "   ";
const TALL_KINDS = new Set([
  "image",
  "video",
  "map",
  "chart",
  "table",
  "embed",
]);

function renderStack(blocks: SketchNode[], width: number): string[] {
  const lines: string[] = [];
  blocks.forEach((block, index) => {
    if (index > 0) {
      lines.push(pad("", width));
    }
    lines.push(...renderNode(block, width));
  });
  return lines;
}

function renderNode(node: SketchNode, width: number): string[] {
  switch (node.type) {
    case "col":
      return renderStack(node.children, width);
    case "row":
      return renderRow(node, width);
    case "text":
      return renderText(node, width);
    case "placeholder":
      return renderPlaceholder(node, width);
  }
}

function renderRow(row: SketchRow, width: number): string[] {
  if (row.children.length === 0) {
    return [];
  }
  const widths = shareWidth(
    row.children.map((child) => (child.type === "col" ? child.weight : 1)),
    width - GUTTER.length * (row.children.length - 1),
  );
  const columns = row.children.map((child, i) => renderNode(child, widths[i]));
  const height = Math.max(...columns.map((c) => c.length));
  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    lines.push(columns.map((c, i) => c[y] ?? pad("", widths[i])).join(GUTTER));
  }
  return lines;
}

/** Splits `total` by `weights`, giving every column at least 1. */
function shareWidth(weights: number[], total: number): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => Math.max(1, Math.floor((total * w) / sum)));
  const rest = total - widths.reduce((a, b) => a + b, 0);
  if (rest > 0) {
    widths[widths.length - 1] += rest;
  }
  return widths;
}

function renderText(text: SketchText, width: number): string[] {
  const body = text.level === 1 ? text.text.toUpperCase() : text.text;
  const lines = wrap(body, width).map((l) => pad(l, width));
  if (text.level === 1 || text.level === 2) {
    const longest = Math.max(...lines.map((l) => l.trimEnd().length));
    lines.push(pad((text.level === 1 ? "=" : "-").repeat(longest), width));
  }
  return lines;
}

function renderPlaceholder(
  placeholder: SketchPlaceholder,
  width: number,
): string[] {
  const inner = Math.max(width - 2, 1);
  const content = [
    `[${placeholder.kind}]`,
    ...(placeholder.label ? wrap(placeholder.label, inner) : []),
    ...(placeholder.media ? [`(${placeholder.media.type} added)`] : []),
  ];
  const height = Math.max(
    content.length,
    placeholder.media || TALL_KINDS.has(placeholder.kind.toLowerCase()) ? 5 : 1,
  );
  const top = Math.floor((height - content.length) / 2);
  const lines = ["+" + "-".repeat(inner) + "+"];
  for (let y = 0; y < height; y++) {
    lines.push("|" + center(content[y - top] ?? "", inner) + "|");
  }
  lines.push("+" + "-".repeat(inner) + "+");
  return lines.map((l) => pad(l, width));
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(rest.slice(0, width));
      rest = rest.slice(width);
    }
    if (current === "") {
      current = rest;
    } else if (current.length + 1 + rest.length <= width) {
      current += " " + rest;
    } else {
      lines.push(current);
      current = rest;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function pad(text: string, width: number): string {
  return text.length >= width
    ? text.slice(0, width)
    : text + " ".repeat(width - text.length);
}

function center(text: string, width: number): string {
  const clipped = text.slice(0, width);
  const left = Math.floor((width - clipped.length) / 2);
  return pad(" ".repeat(left) + clipped, width);
}
