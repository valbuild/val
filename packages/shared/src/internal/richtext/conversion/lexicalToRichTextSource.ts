import {
  LinkSource,
  FILE_REF_PROP,
  Internal,
  VAL_EXTENSION,
  RichTextSource,
  AnyRichTextOptions,
} from "@valbuild/core";
import { getMimeType, mimeTypeToFileExt } from "../../mimeType";
import {
  LexicalImageNode,
  LexicalLineBreakNode,
  LexicalLinkNode,
  LexicalListItemNode,
  LexicalListNode,
  LexicalRootNode,
  LexicalTextNode,
} from "./richTextSourceToLexical";

const HeaderRegEx = /^h([\d+])$/;
// Promise<
//   RichTextSource<AnyRichTextOptions> & { files: Record<string, string> }
// >

type MarkdownIR = {
  type: "block";
  children: (string | LexicalImageNode | LexicalLinkNode)[];
};

const MAX_LINE_LENGTH = 80;
export function lexicalToRichTextSource(
  node: LexicalRootNode
): Promise<
  RichTextSource<AnyRichTextOptions> & { files: Record<string, string> }
> {
  const markdownIRBlocks: MarkdownIR[] = node.children.map(createBlock);
  return fromIRToRichTextSource(markdownIRBlocks);
}

function createBlock(node: LexicalRootNode["children"][number]): MarkdownIR {
  if (node.type === "heading") {
    let headingTag = "";
    const depth = Number(node.tag.match(HeaderRegEx)?.[1]);
    if (Number.isNaN(depth)) {
      throw new Error("Invalid header depth");
    }
    for (let i = 0; i < Number(depth); i++) {
      headingTag += "#";
    }
    const headingText: MarkdownIR["children"] = [`${headingTag} `];
    return {
      type: "block",
      children: headingText.concat(...node.children.map(transformLeafNode)),
    };
  } else if (node.type === "paragraph") {
    if (node.children.length === 0) {
      return {
        type: "block",
        children: ["<br />"],
      };
    }
    return {
      type: "block",
      children: node.children.map((child) => transformLeafNode(child)),
    };
  } else if (node.type === "list") {
    return {
      type: "block",
      children: node.children.flatMap((child, i) =>
        formatListItemNode(getListPrefix(node), child, 0, i === 0)
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

async function fromIRToRichTextSource(
  markdownIRBlocks: MarkdownIR[]
): Promise<
  RichTextSource<AnyRichTextOptions> & { files: Record<string, string> }
> {
  const templateStrings = ["\n"];
  const exprs = [];
  const files: Record<string, string> = {};
  for (let blockIdx = 0; blockIdx < markdownIRBlocks.length; blockIdx++) {
    const block = markdownIRBlocks[blockIdx];
    for (const child of block.children) {
      if (typeof child === "string") {
        templateStrings[templateStrings.length - 1] += child;
      } else {
        if (child.type === "image") {
          exprs.push(await fromLexicalImageNode(child, files));
        } else if (child.type === "link") {
          exprs.push(fromLexicalLinkNode(child));
        } else {
          const exhaustiveCheck: never = child;
          throw new Error(
            `Unexpected node type: ${JSON.stringify(exhaustiveCheck, null, 2)}`
          );
        }
        templateStrings.push("");
      }
    }
    if (blockIdx === markdownIRBlocks.length - 1) {
      templateStrings[templateStrings.length - 1] += "\n";
    } else {
      templateStrings[templateStrings.length - 1] += "\n\n";
    }
  }
  return { [VAL_EXTENSION]: "richtext", templateStrings, exprs: exprs, files };
}

function formatText(node: LexicalTextNode): string {
  const classes =
    typeof node.format === "number" ? fromLexicalFormat(node.format) : [];
  let text = node.text.trimStart();
  const prefixWS = node.text.length - text.length;
  text = text.trimEnd();
  const suffixWS = node.text.length - text.length - prefixWS;
  if (classes.includes("bold") && classes.includes("italic")) {
    text = `***${text}***`;
  } else if (classes.includes("bold")) {
    text = `**${text}**`;
  } else if (classes.includes("italic")) {
    text = `_${text}_`;
  }
  if (classes.includes("line-through")) {
    text = `~~${text}~~`;
  }
  // TODO:
  // text = splitIntoChunks(text);
  return `${" ".repeat(prefixWS)}${text}${" ".repeat(suffixWS)}`;
}

function transformLeafNode(
  node:
    | LexicalTextNode
    | LexicalImageNode
    | LexicalLinkNode
    | LexicalLineBreakNode
): string | LexicalImageNode | LexicalLinkNode {
  if (node.type === "text") {
    return formatText(node);
  } else if (node.type === "linebreak") {
    return "\n";
  } else {
    return node;
  }
}

function formatListItemNode(
  listPrefix: string,
  node: LexicalListItemNode,
  indent: number,
  isFirstTopLevelListItem = false
): (string | LexicalImageNode | LexicalLinkNode)[] {
  const newLine = isFirstTopLevelListItem ? "" : "\n";
  const prefix: (string | LexicalImageNode | LexicalLinkNode)[] = [
    `${newLine}${" ".repeat(indent)}${listPrefix}`,
  ];
  if (node.children?.[0]?.type !== "list") {
    prefix.push(" ");
  }

  return prefix.concat(
    node.children.flatMap((child) => {
      if (child.type === "list") {
        return child.children.flatMap((subChild) =>
          formatListItemNode(getListPrefix(child), subChild, indent + 4)
        );
      } else {
        return [transformLeafNode(child)];
      }
    })
  );
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

const FORMAT_MAPPING = {
  bold: 1, // 0001
  italic: 2, // 0010
  "line-through": 4, // 0100
  // underline: 8, // 1000
};

export function fromLexicalFormat(
  format: number
): (keyof typeof FORMAT_MAPPING)[] {
  return Object.entries(FORMAT_MAPPING).flatMap(([key, value]) => {
    if ((value & /* bitwise and */ format) === value) {
      return [key as keyof typeof FORMAT_MAPPING];
    }
    return [];
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function splitIntoChunks(str: string) {
  let line = "";
  for (let i = 0; i < str.length; i += 80) {
    const chunk = str.substring(i, i + MAX_LINE_LENGTH);
    line += chunk;
    if (i !== str.length - 1 && chunk.length >= 80) {
      line += "\n";
    }
  }
  return line;
}

const textEncoder = new TextEncoder();
async function fromLexicalImageNode(
  node: LexicalImageNode,
  files: Record<string, string>
) {
  if (node.src.startsWith("data:")) {
    const sha256 = await Internal.getSHA256Hash(textEncoder.encode(node.src));
    const mimeType = getMimeType(node.src);
    if (mimeType === undefined) {
      throw new Error(`Could not detect Mime Type for image: ${node.src}`);
    }
    const fileExt = mimeTypeToFileExt(mimeType);
    const filePath = `/public/${sha256}.${fileExt}`;
    files[filePath] = node.src;
    return {
      [VAL_EXTENSION]: "file" as const,
      [FILE_REF_PROP]: filePath,
      metadata: {
        width: node.width || 0,
        height: node.height || 0,
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
        height: node.height || 0,
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

function fromLexicalLinkNode(node: LexicalLinkNode): LinkSource {
  return {
    [VAL_EXTENSION]: "link",
    href: node.url,
    children: node.children.map(formatText) as LinkSource["children"],
  };
}
