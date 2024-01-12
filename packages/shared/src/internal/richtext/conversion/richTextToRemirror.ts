import {
  RichText,
  AnyRichTextOptions,
  RootNode,
  SpanNode,
  BrNode,
  ImageNode,
  LinkNode,
  UnorderedListNode,
  OrderedListNode,
  ListItemNode,
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
  richtext: RichText<AnyRichTextOptions>
): RemirrorJSON {
  return {
    type: "doc",
    content: richtext.children.map((child) => toRemirrorNode(child)),
  };
}

type RemirrorNode = NonNullable<RemirrorJSON["content"]>[number];
function toRemirrorNode(child: RootNode<AnyRichTextOptions>): RemirrorNode {
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
  children: (string | SpanNode<AnyRichTextOptions>)[]
): RemirrorHeading {
  return {
    type: "heading",
    attrs: {
      level,
    },
    content: children.flatMap(convertStringOrSpanNodeToRemirror),
  };
}

function convertStringToRemirror(child: string): RemirrorText {
  return {
    type: "text",
    text: child,
  };
}

function convertStringOrSpanNodeToRemirror(
  child: string | SpanNode<AnyRichTextOptions>
): RemirrorText[] {
  if (typeof child === "string") {
    return [convertStringToRemirror(child)];
  }
  return convertSpanNodeToRemirror(child);
}

function convertSpanNodeToRemirror(
  spanNode: SpanNode<AnyRichTextOptions>
): RemirrorText[] {
  if (spanNode.classes.length === 0 && spanNode.children.length === 1) {
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

  return spanNode.children.map((child) => {
    return {
      type: "text",
      text: child,
      marks: spanNode.classes.map<RemirrorTextMark>((className) => {
        switch (className) {
          case "bold":
            return { type: "bold" };
          case "italic":
            return { type: "italic" };
          case "line-through":
            return { type: "strike" };
          default: {
            const _exhaustiveCheck: never = className;
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
    | SpanNode<AnyRichTextOptions>
    | LinkNode<AnyRichTextOptions>
    | ImageNode<AnyRichTextOptions>
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
  linkNode: LinkNode<AnyRichTextOptions>
): RemirrorText[] {
  return linkNode.children
    .flatMap(convertStringOrSpanNodeToRemirror)
    .map((remirrorText) => {
      return {
        ...remirrorText,
        marks: (remirrorText.marks || []).concat({
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
  imageNode: ImageNode<AnyRichTextOptions>
): RemirrorImage {
  return {
    type: "image",
    attrs: {
      height: imageNode.height,
      width: imageNode.width,
      src: imageNode.src, // at time of writing we are not sure if src as href or data url works, also: how to keep mimeType etc?
    },
  };
}

function convertUlToRemirror(
  ulNode: UnorderedListNode<AnyRichTextOptions>
): RemirrorBulletList {
  return {
    type: "bulletList",
    content: ulNode.children.map(convertListItemToRemirror),
  };
}

function convertOlToRemirror(
  olNode: OrderedListNode<AnyRichTextOptions>
): RemirrorOrderedList {
  return {
    type: "orderedList",
    content: olNode.children.map(convertListItemToRemirror),
  };
}

function convertListItemToRemirror(
  liNode: ListItemNode<AnyRichTextOptions>
): RemirrorListItem {
  return {
    type: "listItem",
    content: convertListItemToRemirrorParagraph(liNode.children),
  };
}

function convertListItemToRemirrorParagraph(
  rtChildren: ListItemNode<AnyRichTextOptions>["children"]
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
      | RemirrorBulletList
      | RemirrorOrderedList
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
