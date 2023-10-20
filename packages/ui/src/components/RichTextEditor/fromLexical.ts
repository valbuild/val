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
  LexicalNode,
  LexicalRootNode,
} from "./conversion";

const HeaderRegEx = /^h([\d+])$/;

export async function fromLexical(
  node: LexicalRootNode
): Promise<
  RichTextSource<AnyRichTextOptions> & { files: Record<string, string> }
> {
  return {
    _type: "richtext",
    ...(await transformRichTextChildren(node.children)),
  };
}
async function transformRichTextChildren(
  children: LexicalRootNode["children"]
): Promise<{
  templateStrings: string[];
  nodes: (FileSource<ImageMetadata> | LinkSource)[];
  files: Record<string, string>;
}> {
  const texts: string[] = [""];
  const nodes: (FileSource<ImageMetadata> | LinkSource)[] = [];
  const files: Record<string, string> = {};
  let didAppendNewLines = false;
  let listContext: "number" | "bullet" | null = null;
  let listIndent = -2;

  async function rec(node: LexicalNode) {
    if (node.type === "heading") {
      const depth = Number(node.tag.match(HeaderRegEx)?.[1]);
      if (Number.isNaN(depth)) {
        throw new Error("Invalid header depth");
      }
      texts[texts.length - 1] += "\n";
      for (let i = 0; i < Number(depth); i++) {
        texts[texts.length - 1] += "#";
      }
      texts[texts.length - 1] += " ";
    } else if (node.type === "paragraph") {
      if (node.children.length === 0) {
        texts[texts.length - 1] += "\n<br>";
      } else {
        texts[texts.length - 1] += "\n";
      }
    } else if (node.type === "list") {
      listIndent += 2;
      if (node.listType === "checked") {
        throw Error(`Checked lists are not supported yet`);
      }
      listContext = node.listType;
      // texts[texts.length - 1] += "\n";
    } else if (node.type === "listitem") {
      if (listContext !== "bullet" && listContext !== "number") {
        throw new Error("Unexpected list context: " + listContext);
      }
      texts[texts.length - 1] += "\n" + " ".repeat(listIndent);
      if (listContext === "bullet") {
        texts[texts.length - 1] += "-";
      } else if (listContext === "number") {
        texts[texts.length - 1] += "1.";
      }
      if (!(node.children.length === 1 && node.children[0].type === "list")) {
        texts[texts.length - 1] += " ";
      }
    } else if (node.type === "text") {
      const classes = fromLexicalFormat(node.format || 0);
      if (classes.includes("bold") && !classes.includes("italic")) {
        texts[texts.length - 1] += "**";
      }
      if (classes.includes("italic") && !classes.includes("bold")) {
        texts[texts.length - 1] += "*";
      }
      if (classes.includes("italic") && classes.includes("bold")) {
        texts[texts.length - 1] += "***";
      }
      if (classes.includes("line-through")) {
        texts[texts.length - 1] += "~~";
      }
      texts[texts.length - 1] += node.text;
    } else if (node.type === "image") {
      nodes.push(await fromLexicalImageNode(node, files));
      texts.push("");
    } else if (node.type === "link") {
      nodes.push(await fromLexicalLinkNode(node, files));
      texts.push("");
    } else {
      //exhaustive match
      const exhaustiveCheck: never = node;
      throw new Error(
        "Unexpected node tag: " + JSON.stringify(node, exhaustiveCheck, 2)
      );
    }

    if (node.type !== "text" && node.type !== "image") {
      for (const child of node.children) {
        await rec(child);
      }
    }

    didAppendNewLines = false;
    if (node.type === "text") {
      const classes = fromLexicalFormat(node.format || 0);
      if (classes.includes("line-through")) {
        texts[texts.length - 1] += "~~";
      }
      if (classes.includes("italic") && classes.includes("bold")) {
        texts[texts.length - 1] += "***";
      }
      if (classes.includes("italic") && !classes.includes("bold")) {
        texts[texts.length - 1] += "*";
      }
      if (classes.includes("bold") && !classes.includes("italic")) {
        texts[texts.length - 1] += "**";
      }
    }

    if (node.type === "paragraph") {
      texts[texts.length - 1] += "\n\n";
    } else if (node.type === "listitem") {
      // texts[texts.length - 1] += "\n";
    } else if (node.type === "list") {
      listContext = null;
      listIndent -= 2;
    } else if (node.type === "heading") {
      // didAppendNewLines = true;
      texts[texts.length - 1] += "";
    }
  }
  children.forEach(rec);

  if (texts[texts.length - 1] && didAppendNewLines) {
    // remove last \n\n
    // texts[texts.length - 1] = texts[texts.length - 1].slice(0, -2);
  }
  return { templateStrings: texts, nodes, files };
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
