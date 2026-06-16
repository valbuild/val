import type { SourcePath } from "@valbuild/core";

export type ChatNodeStyle = "bold" | "italic" | "line-through" | "code";

export interface ChatSpanNode {
  tag: "span";
  styles: ChatNodeStyle[];
  children: [string];
}

export interface ChatBrNode {
  tag: "br";
}

export interface ChatImageNode {
  tag: "img";
  key: string;
  alt?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  mimeType?: string;
}

export interface ChatFieldRefNode {
  tag: "field_ref";
  path: SourcePath;
}

export type ChatInlineNode =
  | string
  | ChatSpanNode
  | ChatBrNode
  | ChatImageNode
  | ChatFieldRefNode;

export interface ChatParagraphNode {
  tag: "p";
  children: ChatInlineNode[];
}

export interface ChatHeadingNode {
  tag: "h1" | "h2" | "h3";
  children: ChatInlineNode[];
}

export interface ChatListItemNode {
  tag: "li";
  children: (ChatParagraphNode | ChatBulletListNode | ChatOrderedListNode)[];
}

export interface ChatBulletListNode {
  tag: "ul";
  children: ChatListItemNode[];
}

export interface ChatOrderedListNode {
  tag: "ol";
  children: ChatListItemNode[];
}

export interface ChatBlockquoteNode {
  tag: "blockquote";
  children: ChatBlockNode[];
}

export type ChatBlockNode =
  | ChatParagraphNode
  | ChatHeadingNode
  | ChatBulletListNode
  | ChatOrderedListNode
  | ChatBlockquoteNode;

export type ChatDocument = ChatBlockNode[];

export const EMPTY_CHAT_DOCUMENT: ChatDocument = [];

export interface ChatEditorRef {
  getDocument(): ChatDocument;
  setDocument(doc: ChatDocument): void;
  clear(): void;
  focus(): void;
  isEmpty(): boolean;
  insertFieldRef(path: SourcePath): void;
}
