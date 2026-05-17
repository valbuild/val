import type { Operation } from "fast-json-patch";
import type { ReactNode } from "react";

export type EditorNodeStyle =
  | "bold"
  | "italic"
  | "line-through"
  | "code"
  | (string & {});

export interface EditorStyleDefinition {
  label: string;
  css: Record<string, string>;
}

export type EditorStyleConfig = Record<string, EditorStyleDefinition>;

export interface EditorSpanNode {
  tag: "span";
  styles: EditorNodeStyle[];
  children: [string];
}

export interface EditorBrNode {
  tag: "br";
}

export interface EditorLinkNode {
  tag: "a";
  href: string;
  children: (string | EditorSpanNode)[];
}

export interface EditorImageNode {
  tag: "img";
  src:
    | string
    | {
        readonly _ref: string;
        readonly _type: "file";
        readonly _tag?: "image";
        readonly metadata?: {
          readonly width?: number;
          readonly height?: number;
          readonly mimeType?: string;
        };
      };
  alt?: string;
}

export interface EditorButtonNode {
  tag: "button";
  variant: string;
  href?: string;
  children: false | [string];
}

export type EditorInlineNode =
  | string
  | EditorSpanNode
  | EditorBrNode
  | EditorLinkNode
  | EditorImageNode
  | EditorButtonNode;

export interface EditorParagraphNode {
  tag: "p";
  children: EditorInlineNode[];
}

export interface EditorHeadingNode {
  tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  children: EditorInlineNode[];
}

export interface EditorListItemNode {
  tag: "li";
  children: (
    | EditorParagraphNode
    | EditorUnorderedListNode
    | EditorOrderedListNode
  )[];
}

export interface EditorUnorderedListNode {
  tag: "ul";
  children: EditorListItemNode[];
}

export interface EditorOrderedListNode {
  tag: "ol";
  children: EditorListItemNode[];
}

export interface EditorBlockquoteNode {
  tag: "blockquote";
  children: EditorBlockNode[];
}

export interface EditorCodeBlockNode {
  tag: "pre";
  children: [string];
}

export interface EditorSummaryNode {
  tag: "summary";
  children: EditorInlineNode[];
}

export interface EditorDetailsNode {
  tag: "details";
  variant?: string;
  children: [EditorSummaryNode, ...EditorBlockNode[]];
}

export type EditorBlockNode =
  | EditorParagraphNode
  | EditorHeadingNode
  | EditorUnorderedListNode
  | EditorOrderedListNode
  | EditorBlockquoteNode
  | EditorCodeBlockNode
  | EditorDetailsNode;

export type EditorDocument = EditorBlockNode[];

export type EditorNode =
  | EditorBlockNode
  | EditorListItemNode
  | EditorInlineNode;

export interface EditorErrorFix {
  id: string;
  label: string;
}

export interface EditorError {
  path: string;
  message: string;
  kind: string;
  fixes?: EditorErrorFix[];
}

export interface EditorFeatures {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  link?: boolean;
  image?: boolean;

  h1?: boolean;
  h2?: boolean;
  h3?: boolean;
  h4?: boolean;
  h5?: boolean;
  h6?: boolean;
  bulletList?: boolean;
  orderedList?: boolean;
  blockquote?: boolean;
  details?: boolean;
  codeBlock?: boolean;
  hardBreak?: boolean;
  button?: boolean;
  fixedToolbar?: boolean;
  floatingToolbar?: boolean;
  gutter?: boolean;
  styles?: EditorStyleConfig;
}

export type ResolvedEditorFeatures = Required<Omit<EditorFeatures, "styles">> &
  Pick<EditorFeatures, "styles">;

export const HEADING_FEATURE_KEYS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
] as const;

export function isAnyHeadingEnabled(features: ResolvedEditorFeatures): boolean {
  return (
    features.h1 ||
    features.h2 ||
    features.h3 ||
    features.h4 ||
    features.h5 ||
    features.h6
  );
}

export const DEFAULT_FEATURES: ResolvedEditorFeatures = {
  bold: true,
  italic: true,
  strikethrough: true,
  code: true,
  link: true,
  image: true,

  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  bulletList: true,
  orderedList: true,
  blockquote: true,
  details: false,
  codeBlock: true,
  hardBreak: true,
  button: false,
  fixedToolbar: true,
  floatingToolbar: true,
  gutter: true,
};

export interface EditorButtonVariant {
  variant: string;
  label: string;
  children: false | "string";
  /** true = free-form URL input; EditorLinkCatalogItem[] = button-specific catalog */
  link?: true | EditorLinkCatalogItem[];
}

export interface EditorDetailsVariant {
  variant: string;
  label: string;
}

export interface EditorLinkCatalogItem {
  title: string;
  subtitle: string;
  image?: string;
  href: string;
}

export interface LinkPickerState {
  kind: "catalog" | "url";
  anchorRect: { left: number; top: number };
  savedFrom: number;
  savedTo: number;
  currentHref: string | null;
  catalog?: EditorLinkCatalogItem[];
  isNewLink?: boolean;
}

export interface EditorImage {
  url: string;
}

export interface EditorChangePayload {
  value: EditorDocument;
  patches: Operation[];
}

export type ImageSelectRenderer = (
  currentSrc: string,
  onSelect: (newSrc: string) => void,
) => ReactNode;

export interface RichTextEditorRef {
  getDocument(): EditorDocument;
  getPatches(base: EditorDocument): Operation[];
  reset(data?: EditorDocument): void;
}
