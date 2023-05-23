import {
  DecoratorNode, LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread
} from "lexical";


export interface ImagePayload {
  altText: string;
  height?: number;
  key?: NodeKey;
  maxWidth?: number;
  src: string;
  width?: number;
}

export type SerializedImageNode = Spread<
  {
    altText: string;
    width?: number;
    maxWidth: number;
    height?: number;
    src: string;
  },
  SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __altText: string;
  __width: "inherit" | number;
  __height: "inherit" | number;
  __maxWidth: number;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(
      node.__src,
      node.__altText,
      node.__width,
      node.__height,
      node.__maxWidth,
      node.__key
    );
  }

  constructor(
    src: string,
    altText?: string,
    width?: "inherit" | number,
    height?: "inherit" | number,
    maxWidth?: number,
    key?: NodeKey
  ) {
    super(key);
    this.__src = src;
    this.__altText = altText || "";
    this.__width = width || "inherit";
    this.__height = height || "inherit";
    this.__maxWidth = maxWidth || 0;
  }

  exportJSON(): SerializedImageNode {
    return {
      altText: this.__altText,
      height: this.__height === "inherit" ? 0 : this.__height,
      maxWidth: this.__maxWidth,
      src: this.__src,
      type: "image",
      version: 1,
      width: this.__width === "inherit" ? 0 : this.__width,
    };
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    const { src } = serializedNode;
    const node = $createImageNode(src);
    return node;
  }

  createDOM(): HTMLElement {
    return document.createElement("div");
  }

  updateDOM(): false {
    return false;
  }

  decorate(): JSX.Element {
    return <img key={this.__key} src={this.__src} alt={this.__altText} width={this.__width} height={this.__height} />;
  }
}
export function $createImageNode(
  src: string,
  altText?: string,
  width?: "inherit" | number,
  height?: "inherit" | number,
  maxWidth?: number,
): ImageNode {
  return new ImageNode(src, altText, width, height, maxWidth);
}

export function $isImageNode(node: LexicalNode | null): boolean {
  return node instanceof ImageNode;
}
