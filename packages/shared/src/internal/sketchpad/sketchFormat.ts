/**
 * A page sketch: a page written as indented text, with four primitives.
 *
 * ```
 * --- /about                   a route: what follows is the page at /about
 * # Our people                 text (a heading: #, ## or ###)
 * We are 40 people in Oslo.    text (a paragraph)
 * ## Hi {field: /x.val.ts?p="t"}  text linked to a content field: typing
 *                              in it writes the field
 * [image: Team photo]          placeholder: [kind] or [kind: label]
 * [hero: Roof](image: /a.jpg)  a placeholder with an image (or video) in it
 * icon hero M3 5h18v14H3z      how every [hero] box is drawn: SVG path data
 * row                          its children side by side
 *   col                        its children stacked; columns share a row
 *     ## Design                equally
 *   col
 *     [button: Join us]
 * ```
 *
 * A sketchpad is not one page's: a route divider starts the part about a
 * page, so one sketch can cover a page and the two it links to.
 *
 * It is a scratch pad, not a layout language: it says WHAT is on a page and
 * roughly WHERE, so an assistant and a person can agree on a page's content
 * before anyone worries about how it looks. The person never sees this text,
 * only the page it describes; the assistant never sees the page, only this.
 * So the two have to be the same thing, and the format is STRICT: there is
 * exactly one way to write what is on the screen. `checkSketch` is that
 * rule, and the server refuses a write that breaks it, with the line to fix.
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

export type SketchNode =
  | SketchRoute
  | SketchRow
  | SketchCol
  | SketchText
  | SketchPlaceholder;

/** The start of the part about one page. Only at the top level. */
export type SketchRoute = {
  type: "route";
  line: number;
  /** The page's route as the site serves it: `/about`, `/blog/[slug]`. */
  route: string;
};

export type SketchRow = {
  type: "row";
  line: number;
  children: SketchNode[];
};

/** Columns share their row equally: a sketch says what, not how wide. */
export type SketchCol = {
  type: "col";
  line: number;
  children: SketchNode[];
};

export type SketchText = {
  type: "text";
  line: number;
  /** 0 is a paragraph; 1-3 are headings. */
  level: 0 | 1 | 2 | 3;
  text: string;
  /**
   * The content field this text is linked to, as a source path
   * (`/content/home.val.ts?p="hero"."title"`): typing in the block writes
   * the field. Written `{field: <source path>}` at the end of the line. One
   * block per field: a second link to the same field is not one.
   */
  field?: string;
};

export type SketchPlaceholder = {
  type: "placeholder";
  line: number;
  kind: string;
  label: string | null;
  media: SketchMedia | null;
};

/**
 * `src` names a file the project has, never a guess: its `path` exactly as
 * the content has it (`/public/val/hero.webp`, or its remote URL), or an
 * image uploaded to the assistant's session, `session:<key>`. Which files
 * those are is the Studio's to check; the text only holds the name.
 */
export type SketchMedia = {
  type: "image" | "video";
  src: string;
};

/** The prefix of a `src` that is an image in the assistant's session. */
export const SESSION_MEDIA_PREFIX = "session:";

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
const ROUTE = /^---(?:\s+(.*))?$/;
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
    const route = ROUTE.exec(content);
    if (route) {
      const path = (route[1] ?? "").trim();
      if (!path.startsWith("/") || /\s/.test(path)) {
        errors.push({
          line,
          message:
            'A route divider names one page by its route, like "--- /about".',
        });
      }
      if (indent > 0) {
        errors.push({
          line,
          message:
            "A route divider starts a page, so it goes at the top level, not indented.",
        });
      }
      // It closes everything open: what follows is another page.
      stack.length = 1;
      stack[0].lastIndent = 0;
      blocks.push({ type: "route", line, route: path });
      return;
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
    if (node.type === "row" && parent.type === "row") {
      errors.push({
        line,
        message: "A row goes in a col, not directly in another row.",
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

/** The link to a content field at the end of a text line. */
const FIELD = / \{field: (.+)\}$/;

function parseContent(
  whole: string,
  line: number,
  errors: SketchError[],
): SketchNode {
  const link = FIELD.exec(whole);
  if (link) {
    const node = parseLine(whole.slice(0, link.index), line, errors);
    if (node.type !== "text") {
      errors.push({
        line,
        message:
          "Only a heading or a paragraph is linked to a field: put {field: ...} at the end of one.",
      });
      return node;
    }
    return { ...node, field: link[1].trim() };
  }
  return parseLine(whole, line, errors);
}

function parseLine(
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
    if (container[2] !== undefined) {
      errors.push({
        line,
        message:
          'Columns share a row equally, so a col takes no number: write "col".',
      });
    }
    return { type: "col", line, children: [] };
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
export function formatSketchText(
  level: SketchText["level"],
  text: string,
  field?: string,
): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const link = field ? ` {field: ${field.replace(/\s+/g, " ").trim()}}` : "";
  if (level > 0) {
    return "#".repeat(level) + " " + flat + link;
  }
  const ambiguous =
    flat.startsWith("\\") ||
    flat.startsWith("[") ||
    CONTAINER.test(flat) ||
    ROUTE.test(flat) ||
    HEADING.test(flat) ||
    ICON.test(flat);
  return (ambiguous ? "\\" + flat : flat) + link;
}

/** The line a placeholder is written as. */
export function formatSketchBox(
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

/**
 * The ONE way of writing `blocks` and `icons`: what `checkSketch` holds every
 * other text to, and what the Studio's editor writes (its own serializer is
 * tested against this one). Two spaces per level; an empty row gets an empty
 * col, so it has somewhere to type; a col outside a row is written as its
 * contents, which is all it shows; the icons last, after one blank line, and
 * no blank line anywhere else; a final newline. Empty text is not written --
 * it is not on the page.
 */
export function formatSketch(
  blocks: SketchNode[],
  icons: Record<string, string>,
): string {
  const lines: string[] = [];
  // One block per field: the first keeps the link.
  const linked = new Set<string>();
  const walk = (node: SketchNode, depth: number, inRow: boolean) => {
    const indent = "  ".repeat(depth);
    switch (node.type) {
      case "text":
        if (node.text) {
          const field =
            node.field && !linked.has(node.field) ? node.field : undefined;
          if (field) {
            linked.add(field);
          }
          lines.push(indent + formatSketchText(node.level, node.text, field));
        }
        return;
      case "placeholder":
        lines.push(indent + formatSketchBox(node));
        return;
      case "route":
        lines.push(`--- ${node.route}`);
        return;
      case "row":
        lines.push(indent + "row");
        if (node.children.length === 0) {
          lines.push(indent + "  col");
        }
        node.children.forEach((child) => walk(child, depth + 1, true));
        return;
      case "col":
        if (!inRow) {
          node.children.forEach((child) => walk(child, depth, false));
          return;
        }
        lines.push(indent + "col");
        node.children.forEach((child) => walk(child, depth + 1, false));
        return;
    }
  };
  blocks.forEach((block) => walk(block, 0, false));
  const iconLines = Object.entries(icons).map(
    ([kind, path]) => `icon ${kind} ${path}`,
  );
  const all = [...lines, ...(iconLines.length > 0 ? ["", ...iconLines] : [])];
  return all.length > 0 ? all.join("\n") + "\n" : "";
}

/**
 * The text of every block linked to a field, by field: what the Studio
 * writes to the content when a linked block changes. The first block wins,
 * as `formatSketch` keeps only its link.
 */
export function sketchFieldTexts(blocks: SketchNode[]): Map<string, string> {
  const texts = new Map<string, string>();
  const walk = (node: SketchNode) => {
    if (node.type === "text") {
      if (node.field && node.text && !texts.has(node.field)) {
        texts.set(node.field, node.text.replace(/\s+/g, " ").trim());
      }
    } else if (node.type === "row" || node.type === "col") {
      node.children.forEach(walk);
    }
  };
  blocks.forEach(walk);
  return texts;
}

/** The pages a sketch is about, in the order it gives them. */
export function sketchRoutes(blocks: SketchNode[]): string[] {
  return blocks.flatMap((block) =>
    block.type === "route" && block.route !== "" ? [block.route] : [],
  );
}

/**
 * What a list names a sketch by: its first top-level heading, the biggest
 * one first. Null for a sketch with no heading, which a list then names by
 * its page.
 */
export function sketchTitle(blocks: SketchNode[]): string | null {
  for (const level of [1, 2, 3]) {
    const heading = blocks.find(
      (block): block is SketchText =>
        block.type === "text" && block.level === level && block.text !== "",
    );
    if (heading) {
      return heading.text;
    }
  }
  return null;
}

/**
 * Everything wrong with `source`, or nothing when it is a sketch exactly as
 * `formatSketch` writes it.
 *
 * Strict on purpose. The person sees the page and the assistant sees the
 * text, so a text with two spellings of one page -- a tab or two spaces, an
 * icon line here or there, a blank line or none -- is a text the assistant
 * cannot trust to be what is on the screen, and that would show it a change
 * nobody made the next time the Studio writes it back. Holding every write
 * to the one spelling rules all of that out at once.
 *
 * The parse errors come first; past those, the first line that is spelled
 * differently, with how it should be spelled.
 */
export function checkSketch(source: string): SketchError[] {
  const { blocks, icons, errors } = parseSketch(source);
  if (errors.length > 0) {
    return errors;
  }
  const canonical = formatSketch(blocks, icons);
  if (canonical === source) {
    return [];
  }
  if (canonical !== "" && !source.endsWith("\n")) {
    return [
      {
        line: source.split("\n").length,
        message: "A sketch ends with a newline.",
      },
    ];
  }
  // Compared without the final newline, so an extra one is an extra line.
  const given = source.slice(0, -1).split("\n");
  const wanted = canonical.slice(0, -1).split("\n");
  for (let i = 0; i < Math.max(given.length, wanted.length); i++) {
    if (given[i] !== wanted[i]) {
      return [
        {
          line: i + 1,
          message:
            wanted[i] === undefined
              ? "Nothing goes here: the sketch ends on the line before."
              : given[i] === ""
                ? "No blank lines: the one blank line in a sketch is before its icons."
                : given[i] === undefined
                  ? `The sketch goes on: "${wanted[i]}".`
                  : `This line is written ${JSON.stringify(wanted[i])} in a sketch: two spaces per level, the icons last after one blank line, and no other blank lines.`,
        },
      ];
    }
  }
  return [];
}
