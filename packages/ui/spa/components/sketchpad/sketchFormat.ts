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
 * before anyone worries about how it looks. The person never sees this text,
 * only the page it describes; the assistant never sees the page, only this.
 * So the two have to be the same thing, and the format is STRICT: there is
 * exactly one way to write what is on the screen. `checkSketch` (in
 * `sketchpadDoc.ts`) is that rule, and an assistant's write that breaks it
 * is refused with the line to fix.
 *
 * Parsing is still forgiving, so a sketch that breaks the rule shows what it
 * can rather than nothing; that is for reading, never for accepting.
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
  type: "page" | "row" | "col";
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
  const stack: Open[] = [
    { type: "page", indent: -1, children: blocks, lastIndent: null },
  ];

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
    if (node.type === "col" && parent.type !== "row") {
      errors.push({
        line,
        message: "A col only goes directly inside a row.",
      });
    }
    parent.children.push(node);
    if (node.type === "row" || node.type === "col") {
      stack.push({
        type: node.type,
        indent,
        children: node.children,
        lastIndent: null,
      });
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
      if (/\s/.test(kind)) {
        // An icon line names a kind by one word, so a kind has to be one.
        errors.push({
          line,
          message: `A box's kind is one word: "[${kind.replace(/\s+/g, "-")}${label ? `: ${label}` : ""}]".`,
        });
      }
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
