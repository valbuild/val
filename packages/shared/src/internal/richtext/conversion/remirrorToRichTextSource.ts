import {
  FILE_REF_PROP,
  Internal,
  VAL_EXTENSION,
  RichTextSource,
  AllRichTextOptions,
  Styles,
} from "@valbuild/core";
import {
  RemirrorBr,
  RemirrorBulletList,
  RemirrorImage,
  RemirrorJSON,
  RemirrorLinkMark,
  RemirrorListItem,
  RemirrorOrderedList,
  RemirrorParagraph,
  RemirrorText,
} from "./remirrorTypes";
import {
  BlockNode,
  HeadingNode,
  ImageNode,
  LinkNode,
  ListItemNode,
  OrderedListNode,
  ParagraphNode,
  SpanNode,
  UnorderedListNode,
} from "@valbuild/core";

export function remirrorToRichTextSource(node: RemirrorJSON): {
  blocks: RichTextSource<AllRichTextOptions>;
  files: Record<string, { value: string; patchPaths: string[][] }>;
} {
  const files: Record<string, { value: string; patchPaths: string[][] }> = {};
  const blocks: BlockNode<AllRichTextOptions>[] = [];
  let i = 0;
  for (const child of node.content) {
    const block = convertBlock([(i++).toString()], child, files);
    blocks.push(block);
  }
  return { blocks, files };
}

function convertBlock(
  path: string[],
  node: RemirrorJSON["content"][number],
  files: Record<string, { value: string; patchPaths: string[][] }>,
): BlockNode<AllRichTextOptions> {
  if (node.type === "heading") {
    const depth = node.attrs?.level || 1;
    if (Number.isNaN(depth)) {
      throw new Error("Invalid header depth");
    }
    return {
      tag: `h${depth}` as `h${1 | 2 | 3 | 4 | 5 | 6}`,
      children:
        node.content?.map((child, i) =>
          convertHeadingChild(
            path.concat("children", i.toString()),
            child,
            files,
          ),
        ) || [],
    };
  } else if (node.type === "paragraph") {
    return convertParagraph(path, node, files);
  } else if (node.type === "bulletList") {
    return convertBulletList(path, node, files);
  } else if (node.type === "orderedList") {
    return convertOrderedList(path, node, files);
  } else {
    const exhaustiveCheck: never = node;
    throw new Error(
      `Unhandled node type: ${
        "type" in exhaustiveCheck ? "exhaustiveCheck.type" : "unknown"
      }`,
    );
  }
}

function convertHeadingChild(
  path: string[],
  node: RemirrorText | RemirrorBr | RemirrorImage,
  files: Record<string, { value: string; patchPaths: string[][] }>,
): HeadingNode<AllRichTextOptions>["children"][number] {
  if (node.type === "text") {
    return convertTextNode(node);
  } else if (node.type === "hardBreak") {
    return {
      tag: "br",
    };
  } else if (node.type === "image") {
    return convertImageNode(path, node, files);
  } else {
    const exhaustiveCheck: never = node;
    throw new Error(
      `Unexpected heading child type: ${JSON.stringify(
        exhaustiveCheck,
        null,
        2,
      )}`,
    );
  }
}

function convertParagraph(
  path: string[],
  child: RemirrorParagraph,
  files: Record<string, { value: string; patchPaths: string[][] }>,
): ParagraphNode<AllRichTextOptions> {
  return {
    tag: "p",
    children:
      child.content?.map((child, i) => {
        if (child.type === "text") {
          return convertTextNode(child);
        } else if (child.type === "hardBreak") {
          return {
            tag: "br",
          };
        } else if (child.type === "image") {
          return convertImageNode(
            path.concat("children", i.toString()),
            child,
            files,
          );
        }
        const exhaustiveCheck: never = child;
        throw new Error(
          `Unexpected paragraph child type: ${JSON.stringify(
            exhaustiveCheck,
            null,
            2,
          )}`,
        );
      }) || [],
  };
}

function convertTextNode(
  node: RemirrorText,
): string | SpanNode<AllRichTextOptions> | LinkNode<AllRichTextOptions> {
  if (node.type === "text") {
    const styles: Styles<AllRichTextOptions>[] =
      node.marks?.flatMap((mark) => {
        if (mark.type !== "link") {
          if (mark.type === "strike") {
            return ["line-through" as const];
          }
          return [mark.type];
        } else {
          return [];
        }
      }) || [];
    if (node.marks?.some((mark) => mark.type === "link")) {
      if (styles.length > 0) {
        return {
          tag: "a",
          href:
            node.marks.find(
              (mark): mark is RemirrorLinkMark => mark.type === "link",
            )?.attrs.href || "",
          children: [
            {
              tag: "span",
              styles,
              children: [node.text],
            },
          ],
        };
      }
      return {
        tag: "a",
        href:
          node.marks.find(
            (mark): mark is RemirrorLinkMark => mark.type === "link",
          )?.attrs.href || "",
        children: [node.text],
      };
    }
    if (styles.length > 0) {
      return {
        tag: "span",
        styles,
        children: [node.text],
      };
    }
    return node.text;
  } else {
    const exhaustiveCheck: never = node.type;
    throw new Error(`Unexpected node type: ${exhaustiveCheck}`);
  }
}

function convertListItem(
  path: string[],
  child: RemirrorListItem,
  files: Record<string, { value: string; patchPaths: string[][] }>,
): ListItemNode<AllRichTextOptions> {
  return {
    tag: "li",
    children:
      child.content?.map(
        (child, i): ListItemNode<AllRichTextOptions>["children"][number] => {
          if (child.type === "paragraph") {
            return convertParagraph(
              path.concat("children", i.toString()),
              child,
              files,
            );
          } else if (child.type === "bulletList") {
            return convertBulletList(
              path.concat("children", i.toString()),
              child,
              files,
            );
          } else if (child.type === "orderedList") {
            return convertOrderedList(
              path.concat("children", i.toString()),
              child,
              files,
            );
          } else {
            const exhaustiveCheck: never = child;
            throw new Error(`Unexpected list child type: ${exhaustiveCheck}`);
          }
        },
      ) || [],
  };
}

function convertBulletList(
  path: string[],
  node: RemirrorBulletList,
  files: Record<string, { value: string; patchPaths: string[][] }>,
): UnorderedListNode<AllRichTextOptions> {
  return {
    tag: "ul",
    children:
      node.content?.map((child, i) => {
        if (child.type === "listItem") {
          return convertListItem(
            path.concat("children", i.toString()),
            child,
            files,
          );
        } else {
          const exhaustiveCheck: never = child.type;
          throw new Error(
            `Unexpected bullet list child type: ${exhaustiveCheck}`,
          );
        }
      }) || [],
  };
}

function convertOrderedList(
  path: string[],
  node: RemirrorOrderedList,
  files: Record<string, { value: string; patchPaths: string[][] }>,
): OrderedListNode<AllRichTextOptions> {
  return {
    tag: "ol",
    children:
      node.content?.map((child, i) => {
        if (child.type === "listItem") {
          return convertListItem(
            path.concat("children", i.toString()),
            child,
            files,
          );
        } else {
          const exhaustiveCheck: never = child.type;
          throw new Error(
            `Unexpected ordered list child type: ${exhaustiveCheck}`,
          );
        }
      }) || [],
  };
}

const textEncoder = new TextEncoder();
function convertImageNode(
  path: string[],
  node: RemirrorImage,
  files: Record<string, { value: string; patchPaths: string[][] }>,
): ImageNode<AllRichTextOptions> {
  if (node.attrs && node.attrs.src.startsWith("data:")) {
    const sha256 = Internal.getSHA256Hash(textEncoder.encode(node.attrs.src));
    const mimeType = Internal.getMimeType(node.attrs.src);
    if (mimeType === undefined) {
      throw new Error(
        `Could not detect Mime Type for image: ${node.attrs.src}`,
      );
    }
    const fileExt = Internal.mimeTypeToFileExt(mimeType);
    const fileName = node.attrs.fileName || `${sha256}.${fileExt}`;
    const filePath = `/public/${fileName}`;
    const existingFilesEntry = files[filePath];
    const thisPath = path
      // file is added as src (see below):
      .concat("src");
    if (existingFilesEntry) {
      existingFilesEntry.patchPaths.push(thisPath);
    } else {
      files[filePath] = {
        value: node.attrs.src,
        patchPaths: [thisPath],
      };
    }

    return {
      tag: "img",
      src: {
        [VAL_EXTENSION]: "file" as const,
        [FILE_REF_PROP]: filePath as `/public/${string}`,
        metadata: {
          width: typeof node.attrs.width === "number" ? node.attrs.width : 0,
          height: typeof node.attrs.height === "number" ? node.attrs.height : 0,
          sha256: sha256 || "",
          mimeType,
        },
      },
    };
  } else if (node.attrs) {
    const sha256 = getParam("sha256", node.attrs.src);
    const patchId = getParam("patch_id", node.attrs.src);
    const noParamsSrc = node.attrs.src.split("?")[0];
    const tag: ImageNode<AllRichTextOptions> = {
      tag: "img" as const,
      src: {
        [VAL_EXTENSION]: "file" as const,
        [FILE_REF_PROP]: `/public${
          node.attrs.src.split("?")[0]
        }` as `/public/${string}`,
        metadata: {
          width: typeof node.attrs.width === "number" ? node.attrs.width : 0,
          height: typeof node.attrs.height === "number" ? node.attrs.height : 0,
          sha256: sha256 || "",
          mimeType:
            (noParamsSrc && Internal.filenameToMimeType(noParamsSrc)) || "",
        },
        ...(patchId ? { patch_id: patchId } : {}),
      },
    };
    return tag;
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
