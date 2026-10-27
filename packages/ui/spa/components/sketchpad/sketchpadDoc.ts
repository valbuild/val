import { Schema, type Node as PMNode } from "prosemirror-model";
import {
  formatSketchBox,
  formatSketchText,
  parseSketch,
  type SketchMedia,
  type SketchNode,
} from "@valbuild/shared/internal";

/**
 * The Sketchpad as a ProseMirror document, so the page is edited the way a
 * document is: one caret that moves through headings, paragraphs, box labels
 * and columns with the arrow keys.
 *
 * The TEXT stays the source of truth -- it is what the assistant reads and
 * writes -- and this document is a view of it that can be typed in. That is
 * why the two functions here go both ways, and why an edit is never kept only
 * in the document: every transaction is written back as text.
 *
 * Groups: `block` is what a page or a column holds; `item` is what a row
 * holds, which is the same plus `col`. A col is only ever inside a row.
 */
/** A row's or a col's outline, and its name in the corner. */
const LAYOUT =
  "relative rounded border border-dashed border-border-primary p-3 pt-5 before:pointer-events-none before:absolute before:left-1.5 before:top-0.5 before:text-[10px] before:text-fg-tertiary before:content-[attr(data-label)]";

export const sketchSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block item",
      content: "text*",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", { class: "relative text-sm text-fg-secondary" }, 0],
    },
    heading: {
      group: "block item",
      attrs: { level: { default: 1 } },
      content: "text*",
      defining: true,
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
      ],
      toDOM: (node) => [
        `h${node.attrs.level}`,
        {
          class:
            "relative " +
            (node.attrs.level === 1
              ? "text-2xl font-semibold leading-tight"
              : node.attrs.level === 2
                ? "text-lg font-semibold leading-snug"
                : "text-sm font-semibold"),
        },
        0,
      ],
    },
    // Drawn by `BoxView`; this is only its fallback.
    box: {
      group: "block item",
      attrs: {
        kind: { default: "block" },
        mediaType: { default: null },
        mediaSrc: { default: null },
      },
      content: "text*",
      defining: true,
      isolating: true,
      toDOM: () => ["div", 0],
    },
    row: {
      group: "block",
      content: "item+",
      isolating: true,
      toDOM: () => [
        "div",
        {
          class:
            // Side by side, except on a phone, where the page it sketches
            // would stack them too and a column is a few words wide.
            LAYOUT +
            " flex flex-col gap-4 sm:flex-row [&>*]:min-w-0 sm:[&>*]:flex-[1_1_0]",
          "data-label": "row",
        },
        0,
      ],
    },
    col: {
      group: "item",
      content: "block+",
      attrs: { weight: { default: 1 } },
      isolating: true,
      toDOM: (node) => [
        "div",
        {
          class: LAYOUT + " flex min-w-0 flex-col gap-3",
          "data-label":
            node.attrs.weight === 1 ? "col" : `col ${node.attrs.weight}`,
          style: `--sk-weight: ${node.attrs.weight}`,
        },
        0,
      ],
    },
    text: { group: "inline" },
  },
  marks: {},
});

const nodes = sketchSchema.nodes;

/** The sketch text as a document, and the icons it draws its boxes with. */
export function docFromSketch(source: string): {
  doc: PMNode;
  icons: Record<string, string>;
} {
  const { blocks, icons } = parseSketch(source);
  const content = blocks.flatMap((block) => toNodes(block, false));
  return {
    doc: nodes.doc.create(
      null,
      content.length > 0 ? content : [nodes.paragraph.create()],
    ),
    icons,
  };
}

function textOf(text: string | null): PMNode[] {
  return text ? [sketchSchema.text(text)] : [];
}

function toNodes(block: SketchNode, inRow: boolean): PMNode[] {
  switch (block.type) {
    case "text":
      return [
        block.level === 0
          ? nodes.paragraph.create(null, textOf(block.text))
          : nodes.heading.create({ level: block.level }, textOf(block.text)),
      ];
    case "placeholder":
      return [
        nodes.box.create(
          {
            kind: block.kind,
            mediaType: block.media?.type ?? null,
            mediaSrc: block.media?.src ?? null,
          },
          textOf(block.label),
        ),
      ];
    case "row": {
      const items = block.children.flatMap((child) =>
        // A row cannot hold a row (it is reported); a col around it can.
        child.type === "row"
          ? [nodes.col.create(null, toNodes(child, false))]
          : toNodes(child, true),
      );
      return [
        nodes.row.create(
          null,
          items.length > 0
            ? items
            : [nodes.col.create(null, nodes.paragraph.create())],
        ),
      ];
    }
    case "col": {
      const children = block.children.flatMap((child) => toNodes(child, false));
      const content =
        children.length > 0 ? children : [nodes.paragraph.create()];
      // A col outside a row lays nothing out: keep what is in it.
      return inRow
        ? [nodes.col.create({ weight: block.weight }, content)]
        : content;
    }
  }
}

/**
 * The document as sketch text: the ONE way of writing it, the same as
 * `formatSketch` in `@valbuild/shared`, which the server holds every write
 * to (`sketchpadDoc.test.ts` pins the two together). Two spaces per level; the icons
 * last, after a blank line, and no blank line anywhere else; a final newline.
 * An empty paragraph or heading -- the place someone is about to type -- is
 * not on the page, so it is not in the text.
 */
export function sketchFromDoc(
  doc: PMNode,
  icons: Record<string, string>,
): string {
  const lines: string[] = [];
  const walk = (node: PMNode, depth: number) => {
    const indent = "  ".repeat(depth);
    const text = node.textContent;
    switch (node.type) {
      case nodes.paragraph:
        if (text) {
          lines.push(indent + formatSketchText(0, text));
        }
        return;
      case nodes.heading:
        if (text) {
          lines.push(
            indent + formatSketchText(levelOf(node.attrs.level), text),
          );
        }
        return;
      case nodes.box:
        lines.push(
          indent +
            formatSketchBox({
              kind: String(node.attrs.kind),
              label: text || null,
              media: mediaOf(node),
            }),
        );
        return;
      case nodes.row:
        lines.push(indent + "row");
        node.forEach((child) => walk(child, depth + 1));
        return;
      case nodes.col:
        lines.push(
          indent +
            (node.attrs.weight === 1 ? "col" : `col ${node.attrs.weight}`),
        );
        node.forEach((child) => walk(child, depth + 1));
        return;
    }
  };
  doc.forEach((node) => walk(node, 0));
  const iconLines = Object.entries(icons).map(
    ([kind, path]) => `icon ${kind} ${path}`,
  );
  const all = [...lines, ...(iconLines.length > 0 ? ["", ...iconLines] : [])];
  return all.length > 0 ? all.join("\n") + "\n" : "";
}

function levelOf(level: unknown): 1 | 2 | 3 {
  return level === 2 ? 2 : level === 3 ? 3 : 1;
}

export function mediaOf(box: PMNode): SketchMedia | null {
  const { mediaType, mediaSrc } = box.attrs;
  if (typeof mediaSrc !== "string") {
    return null;
  }
  return mediaType === "video"
    ? { type: "video", src: mediaSrc }
    : mediaType === "image"
      ? { type: "image", src: mediaSrc }
      : null;
}
