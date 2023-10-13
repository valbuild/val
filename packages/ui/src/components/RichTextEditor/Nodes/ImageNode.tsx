import {
  DecoratorNode,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";

export type ImagePayload = {
  src: string;
  sha256?: string;
  fileExt?: string;
  altText?: string;
  height?: number;
  width?: number;
};

export type SerializedImageNode = Spread<ImagePayload, SerializedLexicalNode>;

export class ImageNode extends DecoratorNode<JSX.Element> {
  __src: string;
  __sha256?: string;
  __imageFileExt?: string;
  __altText?: string;
  __width?: number;
  __height?: number;

  static getType(): string {
    return "image";
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode({
      src: node.__src,
      sha256: node.__sha256,
      altText: node.__altText,
      width: node.__width,
      height: node.__height,
      fileExt: node.__fileExt,
    });
  }

  constructor(payload: ImagePayload, key?: NodeKey) {
    super(key);
    this.__src = payload.src;
    this.__altText = payload.altText;
    this.__width = payload.width;
    this.__height = payload.height;
    this.__imageFileExt = payload.fileExt;
    this.__sha256 = payload.sha256;
  }

  exportJSON(): SerializedImageNode {
    return {
      altText: this.__altText,
      height: this.__width,
      src: this.__src,
      type: "image",
      version: 1,
      fileExt: this.__imageFileExt,
      width: this.__width,
      sha256: this.__sha256,
    };
  }

  static importJSON(serializedNode: SerializedImageNode): ImageNode {
    return $createImageNode(serializedNode);
  }

  createDOM(): HTMLElement {
    return document.createElement("div");
  }

  updateDOM(): false {
    return false;
  }

  decorate(): JSX.Element {
    return (
      <ImageComponent
        src={this.__src}
        altText={this.__altText}
        empty={this.__empty}
        height={this.__height}
        nodeKey={this.getKey()}
      />
    );
  }
}

function ImageComponent(props: {
  empty: boolean;
  altText?: string;
  height?: number;
  nodeKey?: NodeKey;
  src: string;
  width?: number;
}): JSX.Element {
  return <img src={props.src}></img>;
}

export function $createImageNode(payload: ImagePayload): ImageNode {
  return new ImageNode(payload);
}

export function $isImageNode(node: LexicalNode | null): boolean {
  return node instanceof ImageNode;
}
