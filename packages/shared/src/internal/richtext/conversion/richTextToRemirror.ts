import {
  RichText,
  AllRichTextOptions,
  BlockNode,
  SpanNode,
  BrNode,
  ImageNode,
  LinkNode,
  UnorderedListNode,
  OrderedListNode,
  ListItemNode,
  VAL_EXTENSION,
  FILE_REF_PROP,
} from "@valbuild/core";
import {
  RemirrorHeading,
  RemirrorJSON,
  RemirrorTextMark,
  RemirrorParagraph,
  RemirrorText,
  RemirrorBr,
  RemirrorImage,
  RemirrorBulletList,
  RemirrorOrderedList,
  RemirrorListItem,
} from "./remirrorTypes";

export function richTextToRemirror(
  richtext: RichText<AllRichTextOptions>
): RemirrorJSON {
  return {
    type: "doc",
    content: richtext.map((child) => toRemirrorNode(child)),
  };
}

type RemirrorNode = NonNullable<RemirrorJSON["content"]>[number];
function toRemirrorNode(child: BlockNode<AllRichTextOptions>): RemirrorNode {
  switch (child.tag) {
    case "h1":
      return convertHeadingToRemirror(1, child.children);
    case "h2":
      return convertHeadingToRemirror(2, child.children);
    case "h3":
      return convertHeadingToRemirror(3, child.children);
    case "h4":
      return convertHeadingToRemirror(4, child.children);
    case "h5":
      return convertHeadingToRemirror(5, child.children);
    case "h6":
      return convertHeadingToRemirror(6, child.children);
    case "p":
      return convertParagraphToRemirror(child.children);
    case "ul":
      return convertUlToRemirror(child);
    case "ol":
      return convertOlToRemirror(child);
    case "br":
      return convertParagraphToRemirror([child]);
    default: {
      const _exhaustiveCheck: never = child;
      throw Error("Unexpected child node: " + JSON.stringify(_exhaustiveCheck));
    }
  }
}

function convertHeadingToRemirror(
  level: number,
  children: (
    | string
    | SpanNode<AllRichTextOptions>
    | LinkNode<AllRichTextOptions>
    | ImageNode<AllRichTextOptions>
    | BrNode
  )[]
): RemirrorHeading {
  return {
    type: "heading",
    attrs: {
      level,
    },
    content: children.flatMap(convertInlineToRemirror),
  };
}

function convertStringToRemirror(child: string): RemirrorText {
  return {
    type: "text",
    text: child,
  };
}

function convertInlineToRemirror(
  child:
    | string
    | SpanNode<AllRichTextOptions>
    | ImageNode<AllRichTextOptions>
    | LinkNode<AllRichTextOptions>
    | BrNode
): (RemirrorText | RemirrorImage | RemirrorBr)[] {
  if (typeof child === "string") {
    return [convertStringToRemirror(child)];
  }
  if (child.tag === "img") {
    return [convertImageNodeToRemirror(child)];
  }
  if (child.tag === "br") {
    return [createRemirrorBr()];
  }
  if (child.tag === "a") {
    return convertLinkNodeToRemirror(child);
  }
  return convertSpanNodeToRemirror(child);
}

function convertSpanNodeToRemirror(
  spanNode: SpanNode<AllRichTextOptions>
): RemirrorText[] {
  if (spanNode.styles.length === 0 && spanNode.children.length === 1) {
    if (typeof spanNode.children[0] === "string") {
      return [convertStringToRemirror(spanNode.children[0])];
    } else {
      // TODO: replace with error logging and something more graceful?
      throw Error(
        "Unexpected amount of children in span node: " +
          JSON.stringify(spanNode, null, 2)
      );
    }
  }
  const uniqueStyles = Array.from(new Set(spanNode.styles));
  return spanNode.children.map((child) => {
    return {
      type: "text",
      text: child,
      marks: uniqueStyles.map<RemirrorTextMark>((style) => {
        switch (style) {
          case "bold":
            return { type: "bold" };
          case "italic":
            return { type: "italic" };
          case "line-through":
            return { type: "strike" };
          default: {
            const _exhaustiveCheck: never = style;
            throw Error("Unexpected span class: " + _exhaustiveCheck);
          }
        }
      }),
    };
  });
}

function convertParagraphToRemirror(
  children: (
    | string
    | BrNode
    | SpanNode<AllRichTextOptions>
    | LinkNode<AllRichTextOptions>
    | ImageNode<AllRichTextOptions>
  )[]
): RemirrorParagraph {
  return {
    type: "paragraph",
    content: children.flatMap<
      NonNullable<RemirrorParagraph["content"]>[number]
    >((child) => {
      if (typeof child === "string") {
        return [convertStringToRemirror(child)];
      }
      switch (child.tag) {
        case "span":
          return convertSpanNodeToRemirror(child);
        case "a":
          return convertLinkNodeToRemirror(child);
        case "img":
          return [convertImageNodeToRemirror(child)];
        case "br":
          return [createRemirrorBr()];
        default: {
          const _exhaustiveCheck: never = child;
          throw Error(
            "Unexpected paragraph child: " + JSON.stringify(_exhaustiveCheck)
          );
        }
      }
    }),
  };
}

function createRemirrorBr(): RemirrorBr {
  return {
    type: "hardBreak",
    marks: [],
  };
}

function convertLinkNodeToRemirror(
  linkNode: LinkNode<AllRichTextOptions>
): (RemirrorText | RemirrorImage | RemirrorBr)[] {
  return linkNode.children
    .flatMap(convertInlineToRemirror)
    .map((remirrorNode) => {
      if (remirrorNode.type !== "text") {
        return remirrorNode;
      }
      return {
        ...remirrorNode,
        marks: (remirrorNode.marks || []).concat({
          type: "link",
          attrs: {
            href: linkNode.href,
            auto: false,
            target: null,
          },
        }),
      };
    });
}

function convertImageNodeToRemirror(
  imageNode: ImageNode<AllRichTextOptions>
): RemirrorImage {
  const fileSource = imageNode.children[0];
  if (!(VAL_EXTENSION in fileSource) || fileSource[VAL_EXTENSION] !== "file") {
    throw Error("Expected file source in image node");
  }
  return {
    type: "image",
    attrs: {
      height: fileSource.metadata?.height,
      width: fileSource.metadata?.width,
      src: `/api/val/files${fileSource[FILE_REF_PROP]}`, // at time of writing we are not sure if src as href or data url works, also: how to keep mimeType etc?
    },
  };
}

function convertUlToRemirror(
  ulNode: UnorderedListNode<AllRichTextOptions>
): RemirrorBulletList {
  return {
    type: "bulletList",
    content: ulNode.children.map(convertListItemToRemirror),
  };
}

function convertOlToRemirror(
  olNode: OrderedListNode<AllRichTextOptions>
): RemirrorOrderedList {
  return {
    type: "orderedList",
    content: olNode.children.map(convertListItemToRemirror),
  };
}

function convertListItemToRemirror(
  liNode: ListItemNode<AllRichTextOptions>
): RemirrorListItem {
  return {
    type: "listItem",
    content: convertListItemToRemirrorParagraph(liNode.children),
  };
}

function convertListItemToRemirrorParagraph(
  rtChildren: ListItemNode<AllRichTextOptions>["children"]
): RemirrorListItem["content"] {
  const children: RemirrorListItem["content"] = [];
  for (const child of rtChildren) {
    let lastChild:
      | RemirrorParagraph
      | RemirrorBulletList
      | RemirrorOrderedList
      | undefined = children[children.length - 1];
    if (!lastChild) {
      lastChild = {
        type: "paragraph",
        content: [],
      };
      children.push(lastChild);
    }
    const lastChildContent = lastChild.content as (
      | RemirrorText
      | RemirrorImage
      | RemirrorBr
      | RemirrorBulletList
      | RemirrorOrderedList
      | RemirrorParagraph
    )[];
    if (typeof child === "string") {
      lastChildContent.push(convertStringToRemirror(child));
    } else {
      switch (child.tag) {
        case "a": {
          lastChildContent.push(...convertLinkNodeToRemirror(child));
          break;
        }
        case "br": {
          children.push({
            type: "paragraph",
            content: [], // create new paragraph
          });
          break;
        }
        case "span": {
          lastChildContent.push(...convertSpanNodeToRemirror(child));
          break;
        }
        case "ol": {
          children.push(convertOlToRemirror(child));
          break;
        }
        case "ul": {
          children.push(convertUlToRemirror(child));
          break;
        }
        case "p": {
          const newChild = convertParagraphToRemirror(child.children);
          if (lastChild.type === "paragraph" && newChild.type === "paragraph") {
            if (newChild.content) {
              lastChildContent.push(...newChild.content);
            } else {
              // no content - skip
            }
          }
          children.push(newChild);
          break;
        }
        default: {
          const _exhaustiveCheck: never = child;
          throw Error(
            "Unexpected list item child: " + JSON.stringify(_exhaustiveCheck)
          );
        }
      }
    }
  }
  return children;
}
