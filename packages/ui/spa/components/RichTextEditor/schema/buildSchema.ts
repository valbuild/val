import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";
import type {
  EditorButtonVariant,
  EditorDetailsVariant,
  EditorStyleConfig,
  ResolvedEditorFeatures,
  EditorFeatures,
} from "../types";

export const CUSTOM_STYLE_PREFIX = "custom_style_";

function cssObjectToStyleString(css: Record<string, string>): string {
  return Object.entries(css)
    .map(([prop, value]) => {
      const kebab = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      return `${kebab}: ${value}`;
    })
    .join("; ");
}

function buildNodes(
  _features: ResolvedEditorFeatures,
  buttonVariants?: EditorButtonVariant[],
): Record<string, NodeSpec> {
  const variantLabelMap = new Map(
    (buttonVariants ?? []).map((v) => [v.variant, v.label]),
  );

  const nodes: Record<string, NodeSpec> = {
    doc: { content: "block+" },
    paragraph: {
      content: "inline*",
      group: "block",
      parseDOM: [{ tag: "p" }],
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
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        attrs: { level },
      })),
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
    code_block: {
      content: "text*",
      marks: "",
      group: "block",
      code: true,
      defining: true,
      parseDOM: [{ tag: "pre", preserveWhitespace: "full" }],
      toDOM() {
        return ["pre", ["code", 0]];
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
      attrs: {
        src: {},
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
          tag: "img[src]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return { src: el.getAttribute("src"), alt: el.getAttribute("alt") };
          },
        },
      ],
      toDOM(node) {
        return ["img", { src: node.attrs.src, alt: node.attrs.alt }];
      },
    },
  };

  if (_features.button) {
    nodes.button_atom = {
      inline: true,
      atom: true,
      group: "inline",
      attrs: { variant: { default: "default" } },
      parseDOM: [
        {
          tag: "button[data-variant][data-atom]",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return { variant: el.getAttribute("data-variant") };
          },
        },
      ],
      toDOM(node) {
        const variant = node.attrs.variant as string;
        const label = variantLabelMap.get(variant) ?? variant;
        return [
          "button",
          {
            "data-variant": variant,
            "data-atom": "true",
            class:
              "inline-flex items-center rounded bg-bg-brand-secondary px-2 py-0.5 text-sm font-medium text-fg-brand-secondary cursor-default",
            contenteditable: "false",
          },
          label,
        ];
      },
    };
    nodes.button_editable = {
      inline: true,
      content: "text*",
      group: "inline",
      attrs: { variant: { default: "default" }, href: { default: null } },
      parseDOM: [
        {
          tag: "button[data-variant]:not([data-atom])",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return {
              variant: el.getAttribute("data-variant"),
              href: el.getAttribute("data-href") || null,
            };
          },
        },
      ],
      toDOM(node) {
        const domAttrs: Record<string, string> = {
          "data-variant": node.attrs.variant,
          class:
            "inline-flex items-center rounded bg-bg-brand-secondary px-2 py-0.5 text-sm font-medium text-fg-brand-secondary",
        };
        if (node.attrs.href) {
          domAttrs["data-href"] = node.attrs.href;
        }
        return ["button", domAttrs, 0];
      },
    };
  }

  if (_features.details) {
    nodes.details_summary = {
      content: "inline*",
      defining: true,
      parseDOM: [{ tag: "summary" }],
      toDOM() {
        return ["summary", 0];
      },
    };
    nodes.details = {
      attrs: { variant: { default: "details" } },
      content: "details_summary block+",
      group: "block",
      defining: true,
      parseDOM: [
        {
          tag: "details",
          getAttrs(dom) {
            const el = dom as HTMLElement;
            return { variant: el.getAttribute("data-variant") || "details" };
          },
        },
      ],
      toDOM(node) {
        const variant = node.attrs.variant as string;
        const domAttrs: Record<string, string> = { open: "" };
        if (variant !== "details") {
          domAttrs["data-variant"] = variant;
        }
        return ["details", domAttrs, 0];
      },
    };
  }

  return nodes;
}

function buildMarks(
  _features: ResolvedEditorFeatures,
  styleConfig?: EditorStyleConfig,
): Record<string, MarkSpec> {
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
  marks.link = {
    attrs: { href: {} },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs(dom) {
          const el = dom as HTMLElement;
          const href = el.getAttribute("href") || "";
          return { href };
        },
      },
    ],
    toDOM(node) {
      return ["a", { href: node.attrs.href, rel: "noopener noreferrer" }, 0];
    },
  };

  if (styleConfig) {
    for (const [name, def] of Object.entries(styleConfig)) {
      const markName = `${CUSTOM_STYLE_PREFIX}${name}`;
      const styleStr = cssObjectToStyleString(def.css);
      marks[markName] = {
        parseDOM: [
          {
            tag: `span[data-style="${name}"]`,
          },
        ],
        toDOM() {
          return ["span", { "data-style": name, style: styleStr }, 0];
        },
      };
    }
  }

  return marks;
}

export interface BuildSchemaOptions {
  features?: Partial<EditorFeatures>;
  buttonVariants?: EditorButtonVariant[];
  detailsVariants?: EditorDetailsVariant[];
  styleConfig?: EditorStyleConfig;
}

export function buildSchema(
  featuresOrOptions: Partial<EditorFeatures> | BuildSchemaOptions = {},
): Schema {
  const isOptions =
    "features" in featuresOrOptions ||
    "buttonVariants" in featuresOrOptions ||
    "detailsVariants" in featuresOrOptions ||
    "styleConfig" in featuresOrOptions;
  const features: Partial<EditorFeatures> = isOptions
    ? ((featuresOrOptions as BuildSchemaOptions).features ?? {})
    : (featuresOrOptions as Partial<EditorFeatures>);
  const buttonVariants = isOptions
    ? (featuresOrOptions as BuildSchemaOptions).buttonVariants
    : undefined;
  const styleConfig = isOptions
    ? ((featuresOrOptions as BuildSchemaOptions).styleConfig ?? features.styles)
    : features.styles;

  const resolved: ResolvedEditorFeatures = {
    bold: features.bold ?? true,
    italic: features.italic ?? true,
    strikethrough: features.strikethrough ?? true,
    code: features.code ?? true,
    link: features.link ?? true,
    image: features.image ?? true,

    h1: features.h1 ?? true,
    h2: features.h2 ?? true,
    h3: features.h3 ?? true,
    h4: features.h4 ?? true,
    h5: features.h5 ?? true,
    h6: features.h6 ?? true,
    bulletList: features.bulletList ?? true,
    orderedList: features.orderedList ?? true,
    blockquote: features.blockquote ?? true,
    details: features.details ?? false,
    codeBlock: features.codeBlock ?? true,
    hardBreak: features.hardBreak ?? true,
    button: features.button ?? false,
    fixedToolbar: features.fixedToolbar ?? true,
    floatingToolbar: features.floatingToolbar ?? true,
    gutter: features.gutter ?? true,
    styles: features.styles,
  };

  return new Schema({
    nodes: buildNodes(resolved, buttonVariants),
    marks: buildMarks(resolved, styleConfig),
  });
}
