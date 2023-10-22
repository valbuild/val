import {
  RichTextSource,
  AnyRichTextOptions,
  RichTextNode,
  FileSource,
  ImageMetadata,
  LinkSource,
  FILE_REF_PROP,
  Internal,
  VAL_EXTENSION,
} from "@valbuild/core";
import { mimeTypeToFileExt } from "../../utils/imageMimeType";

import {
  fromLexicalFormat,
  fromLexicalNode,
  LexicalImageNode,
  LexicalLinkNode,
  LexicalListItemNode,
  LexicalListNode,
  LexicalNode,
  LexicalRootNode,
  LexicalTextNode,
} from "./conversion";

const HeaderRegEx = /^h([\d+])$/;
// Promise<
//   RichTextSource<AnyRichTextOptions> & { files: Record<string, string> }
// >

type MarkdownIR = {
  type: "block";
  children: (string | LexicalImageNode | LexicalLinkNode)[];
};

export function fromLexical(node: LexicalRootNode) {
  function formatText(node: LexicalTextNode): string {
    // TODO: formatting
    return node.text;
  }

  function transformLeafNode(
    node: LexicalTextNode | LexicalImageNode | LexicalLinkNode
  ): string | LexicalImageNode | LexicalLinkNode {
    if (node.type === "text") {
      return formatText(node);
    } else {
      return node;
    }
  }

  function getListPrefix(node: LexicalListNode): string {
    if (node.listType === "bullet") {
      return "-";
    } else if (node.listType === "number") {
      return "1.";
    } else {
      throw new Error(`Unhandled list type: ${node.listType}`);
    }
  }

  function formatListItemNode(
    listPrefix: string,
    node: LexicalListItemNode,
    indent: number
  ): (string | LexicalImageNode | LexicalLinkNode)[] {
    return node.children.flatMap((child) => {
      if (child.type === "list") {
        const subChildren: (string | LexicalImageNode | LexicalLinkNode)[] = [
          `${listPrefix}\n`,
        ];
        return subChildren.concat(
          formatListItemNode(getListPrefix(child), child, indent + 4)
        );
      } else {
        return [`\n${listPrefix} `, transformLeafNode(child)];
      }
    });
  }

  function createBlock(node: LexicalRootNode["children"][number]): MarkdownIR {
    if (node.type === "heading") {
      const headingTag = "#";
      const headingText: MarkdownIR["children"] = [`${headingTag} `];
      return {
        type: "block",
        children: headingText.concat(...node.children.map(transformLeafNode)),
      };
    } else if (node.type === "paragraph") {
      return {
        type: "block",
        children: node.children.map(transformLeafNode),
      };
    } else if (node.type === "list") {
      return {
        type: "block",
        children: node.children.flatMap((child) =>
          formatListItemNode(getListPrefix(node), child, 0)
        ),
      };
    } else {
      const exhaustiveCheck: never = node;
      throw new Error(
        `Unhandled node type: ${
          "type" in exhaustiveCheck ? "exhaustiveCheck.type" : "unknown"
        }`
      );
    }
  }

  return node.children.map(createBlock);
}

const textEncoder = new TextEncoder();
async function fromLexicalImageNode(
  node: LexicalImageNode,
  files: Record<string, string>
) {
  if (node.src.startsWith("data:")) {
    const sha256 = await Internal.getSHA256Hash(textEncoder.encode(node.src));
    const fileExt = mimeTypeToFileExt(node.src);
    const filePath = `/public/${sha256}.${fileExt}`;
    files[filePath] = node.src;
    return {
      [VAL_EXTENSION]: "file" as const,
      [FILE_REF_PROP]: filePath,
      metadata: {
        width: node.width || 0,
        height: node.width || 0,
        sha256: sha256 || "",
      },
    };
  } else {
    const sha256 = getParam("sha256", node.src);
    return {
      [VAL_EXTENSION]: "file" as const,
      [FILE_REF_PROP]: `/public${node.src.split("?")[0]}`,
      metadata: {
        width: node.width || 0,
        height: node.width || 0,
        sha256: sha256 || "",
      },
    };
  }
}

function getParam(param: string, url: string) {
  const urlParts = url.split("?");
  if (urlParts.length < 2) {
    return undefined;
  }

  const queryString = urlParts[1];
  const params = new URLSearchParams(queryString);

  if (params.has(param)) {
    return params.get(param);
  }

  return undefined;
}

async function fromLexicalLinkNode(
  node: LexicalLinkNode,
  files: Record<string, string>
): Promise<LinkSource> {
  return {
    [VAL_EXTENSION]: "link",
    href: node.url,
    children: (await Promise.all(
      node.children.map((node) => fromLexicalNode(node, files))
    )) as LinkSource["children"],
  };
}
