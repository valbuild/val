import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";

function buildNodes(): Record<string, NodeSpec> {
  const nodes: Record<string, NodeSpec> = {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [
        { tag: "p" },
        // h4-h6 are unsupported in chat; downgrade to paragraph on paste.
        { tag: "h4" },
        { tag: "h5" },
        { tag: "h6" },
      ],
      toDOM() {
        return ["p", 0];
      },
    },
    text: { group: "inline" },
    hard_break: {
      inline: true,
      group: "inline",
      selectable: false,
      parseDOM: [{ tag: "br" }],
      toDOM() {
        return ["br"];
      },
    },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block",
      defining: true,
      parseDOM: [
        { tag: "h1", attrs: { level: 1 } },
        { tag: "h2", attrs: { level: 2 } },
        { tag: "h3", attrs: { level: 3 } },
      ],
      toDOM(node) {
        return [`h${node.attrs.level}`, 0];
      },
    },
    blockquote: {
      content: "block+",
      group: "block",
      defining: true,
      parseDOM: [{ tag: "blockquote" }],
      toDOM() {
        return ["blockquote", 0];
      },
    },
    list_item: {
      content: "paragraph block*",
      parseDOM: [{ tag: "li" }],
      toDOM() {
        return ["li", 0];
      },
      defining: true,
    },
    bullet_list: {
      content: "list_item+",
      group: "block",
      parseDOM: [{ tag: "ul" }],
      toDOM() {
        return ["ul", 0];
      },
    },
    ordered_list: {
      attrs: { order: { default: 1 } },
      content: "list_item+",
      group: "block",
      parseDOM: [
        {
          tag: "ol",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return {
              order: el.hasAttribute("start")
                ? +(el.getAttribute("start") || 1)
                : 1,
            };
          },
        },
      ],
      toDOM(node) {
        return node.attrs.order === 1
          ? ["ol", 0]
          : ["ol", { start: node.attrs.order }, 0];
      },
    },
    image: {
      inline: true,
      atom: true,
      attrs: {
        key: { default: "" },
        alt: { default: null },
        previewUrl: { default: null },
        width: { default: null },
        height: { default: null },
        mimeType: { default: null },
      },
      group: "inline",
      draggable: true,
      parseDOM: [
        {
          tag: "img[data-val-ai-key]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return {
              key: el.getAttribute("data-val-ai-key") || "",
              alt: el.getAttribute("alt"),
              previewUrl: el.getAttribute("src"),
            };
          },
        },
        {
          tag: "img[src]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            // Pasted/dropped images without a key: mark for re-upload.
            return {
              key: `pending:${Math.random().toString(36).slice(2)}`,
              alt: el.getAttribute("alt"),
              previewUrl: el.getAttribute("src"),
            };
          },
        },
      ],
      toDOM(node) {
        return [
          "img",
          {
            src: node.attrs.previewUrl ?? "",
            alt: node.attrs.alt ?? "",
            "data-val-ai-key": node.attrs.key,
          },
        ];
      },
    },
    field_ref: {
      inline: true,
      atom: true,
      selectable: true,
      draggable: false,
      attrs: { path: { default: "" } },
      group: "inline",
      parseDOM: [
        {
          tag: "span[data-val-field-ref]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return { path: el.getAttribute("data-val-field-ref") || "" };
          },
        },
      ],
      toDOM(node) {
        return [
          "span",
          {
            "data-val-field-ref": node.attrs.path,
            contenteditable: "false",
            class:
              "inline-flex items-center align-baseline rounded bg-bg-secondary text-fg-primary px-1.5 py-0.5 text-xs font-mono mx-0.5",
          },
          node.attrs.path,
        ];
      },
    },
  };
  return nodes;
}

function buildMarks(): Record<string, MarkSpec> {
  const marks: Record<string, MarkSpec> = {};

  marks.bold = {
    parseDOM: [
      { tag: "strong" },
      {
        tag: "b",
        getAttrs: (node) =>
          (node as HTMLElement).style.fontWeight !== "normal" && null,
      },
      { style: "font-weight=bold" },
      {
        style: "font-weight",
        getAttrs: (value) =>
          /^(bold(er)?|[5-9]\d{2,})$/.test(value as string) && null,
      },
    ],
    toDOM() {
      return ["strong", 0];
    },
  };

  marks.italic = {
    parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
    toDOM() {
      return ["em", 0];
    },
  };

  marks.strikethrough = {
    parseDOM: [
      { tag: "s" },
      { tag: "del" },
      { style: "text-decoration=line-through" },
    ],
    toDOM() {
      return ["del", 0];
    },
  };

  marks.code = {
    parseDOM: [{ tag: "code" }],
    toDOM() {
      return ["code", 0];
    },
  };

  return marks;
}

export function buildChatSchema(): Schema {
  return new Schema({ nodes: buildNodes(), marks: buildMarks() });
}
