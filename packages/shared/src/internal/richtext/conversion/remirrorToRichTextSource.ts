import {
  LinkSource,
  FILE_REF_PROP,
  Internal,
  VAL_EXTENSION,
  RichTextSource,
  AnyRichTextOptions,
  ImageSource,
  Classes,
} from "@valbuild/core";
import {
  filenameToMimeType,
  getMimeType,
  mimeTypeToFileExt,
} from "../../mimeType";
import {
  RemirrorBr,
  RemirrorBulletList,
  RemirrorImage,
  RemirrorJSON,
  RemirrorLinkMark,
  RemirrorListItem,
  RemirrorOrderedList,
  RemirrorText,
} from "./remirrorTypes";

type MarkdownIR = {
  type: "block";
  children: (string | ImageSource | LinkSource)[];
};

const MAX_LINE_LENGTH = 80;
export function remirrorToRichTextSource(
  node: RemirrorJSON
): RichTextSource<AnyRichTextOptions> & { files: Record<string, string> } {
  const files: Record<string, string> = {};
  const markdownIRBlocks: MarkdownIR[] = node.content.map((child) =>
    createBlock(child, files)
  );
  return fromIRToRichTextSource(markdownIRBlocks, files);
}

function createBlock(
  node: RemirrorJSON["content"][number],
  files: Record<string, string>
): MarkdownIR {
  if (node.type === "heading") {
    let headingTag = "";
    const depth = node.attrs?.level || 1;
    if (Number.isNaN(depth)) {
      throw new Error("Invalid header depth");
    }
    for (let i = 0; i < Number(depth); i++) {
      headingTag += "#";
    }
    const headingText: MarkdownIR["children"] = [`${headingTag} `];
    return {
      type: "block",
      children: headingText.concat(
        ...(node.content?.map((child) => transformLeafNode(child, files)) || [])
      ),
    };
  } else if (node.type === "paragraph") {
    if (!node.content || node.content?.length === 0) {
      return {
        type: "block",
        children: ["<br />"],
      };
    }
    return {
      type: "block",
      children: node.content.map((child) => transformLeafNode(child, files)),
    };
  } else if (node.type === "bulletList" || node.type === "orderedList") {
    return {
      type: "block",
      children:
        node.content?.flatMap((child, i) =>
          formatListItemNode(getListPrefix(node), child, 0, files, i === 0)
        ) || [],
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

function fromIRToRichTextSource(
  markdownIRBlocks: MarkdownIR[],
  files: Record<string, string>
): RichTextSource<AnyRichTextOptions> & { files: Record<string, string> } {
  const templateStrings = ["\n"];
  const exprs = [];
  for (let blockIdx = 0; blockIdx < markdownIRBlocks.length; blockIdx++) {
    const block = markdownIRBlocks[blockIdx];
    for (const child of block.children) {
      if (typeof child === "string") {
        templateStrings[templateStrings.length - 1] += child;
      } else {
        if (child._type === "file") {
          exprs.push(child);
        } else if (child._type === "link") {
          exprs.push(child);
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

function formatText(node: RemirrorText): string {
  const classes: Classes<AnyRichTextOptions>[] =
    node.marks?.flatMap((mark) => {
      if (mark.type === "bold") {
        return ["bold"];
      } else if (mark.type === "italic") {
        return ["italic"];
      } else if (mark.type === "strike") {
        return ["line-through"];
      }
      return [];
    }) || [];

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
  node: RemirrorText | RemirrorImage | RemirrorBr,
  files: Record<string, string>
): string | ImageSource | LinkSource {
  if (node.type === "text") {
    const linkMark = node.marks?.find(
      (mark): mark is RemirrorLinkMark => mark.type === "link"
    );
    if (linkMark?.type === "link") {
      return {
        _type: "link",
        href: linkMark.attrs.href,
        children: [formatText(node)],
      };
    }
    return formatText(node);
  } else if (node.type === "hardBreak") {
    return "<br />";
  } else if (node.type === "image") {
    return fromRemirrorImageNode(node, files);
  } else {
    const exhaustiveCheck: never = node;
    throw new Error(`Unexpected node type: ${JSON.stringify(exhaustiveCheck)}`);
  }
}

function formatListItemNode(
  listPrefix: string,
  node: RemirrorListItem,
  indent: number,
  files: Record<string, string>,
  isFirstTopLevelListItem = false
): (string | ImageSource | LinkSource)[] {
  const newLine = isFirstTopLevelListItem ? "" : "\n";
  const prefix: (string | ImageSource | LinkSource)[] = [
    `${newLine}${" ".repeat(indent)}${listPrefix}`,
  ];
  if (
    !(
      node.content?.[0]?.type === "bulletList" ||
      node.content?.[0]?.type === "orderedList"
    )
  ) {
    prefix.push(" ");
  }

  return prefix.concat(
    (node.content || []).flatMap((child, i) => {
      if (child.type === "bulletList" || child.type === "orderedList") {
        return (child.content || []).flatMap((subChild) =>
          formatListItemNode(getListPrefix(child), subChild, indent + 4, files)
        );
      } else {
        return (child.content || []).flatMap((subChild) => {
          const res: (string | ImageSource | LinkSource)[] = [];
          if (child.content?.length && child.content?.length > 0 && i > 0) {
            res.push("<br />\n");
          }
          res.push(transformLeafNode(subChild, files));
          return res;
        });
      }
    })
  );
}

function getListPrefix(node: RemirrorBulletList | RemirrorOrderedList): string {
  if (node.type === "bulletList") {
    return "-";
  } else if (node.type === "orderedList") {
    return "1.";
  } else {
    const exhaustiveCheck: never = node;
    throw new Error(`Unhandled list node: ${JSON.stringify(exhaustiveCheck)}`);
  }
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
function fromRemirrorImageNode(
  node: RemirrorImage,
  files: Record<string, string>
): ImageSource {
  if (node.attrs && node.attrs.src.startsWith("data:")) {
    const sha256 = Internal.getSHA256Hash(textEncoder.encode(node.attrs.src));
    const mimeType = getMimeType(node.attrs.src);
    if (mimeType === undefined) {
      throw new Error(
        `Could not detect Mime Type for image: ${node.attrs.src}`
      );
    }
    const fileExt = mimeTypeToFileExt(mimeType);
    const fileName = node.attrs.fileName || `${sha256}.${fileExt}`;
    const filePath = `/public/${fileName}`;
    files[filePath] = node.attrs.src;
    return {
      [VAL_EXTENSION]: "file" as const,
      [FILE_REF_PROP]: filePath as `/public/${string}`,
      metadata: {
        width: typeof node.attrs.width === "number" ? node.attrs.width : 0,
        height: typeof node.attrs.height === "number" ? node.attrs.height : 0,
        sha256: sha256 || "",
        mimeType,
      },
    };
  } else if (node.attrs) {
    const sha256 = getParam("sha256", node.attrs.src);
    const noParamsSrc = node.attrs.src.split("?")[0];
    return {
      [VAL_EXTENSION]: "file" as const,
      [FILE_REF_PROP]: `/public${
        node.attrs.src.split("?")[0]
      }` as `/public/${string}`,
      metadata: {
        width: typeof node.attrs.width === "number" ? node.attrs.width : 0,
        height: typeof node.attrs.height === "number" ? node.attrs.height : 0,
        sha256: sha256 || "",
        mimeType: (noParamsSrc && filenameToMimeType(noParamsSrc)) || "",
      },
    };
  } else {
    throw new Error("Invalid image node (no attrs): " + JSON.stringify(node));
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
