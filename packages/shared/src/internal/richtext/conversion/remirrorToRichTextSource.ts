import {
  FILE_REF_PROP,
  Internal,
  VAL_EXTENSION,
  RichTextSource,
  AllRichTextOptions,
  Styles,
  FILE_REF_SUBTYPE_TAG,
  ConfigDirectory,
  SerializedImageSchema,
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
import { Buffer } from "buffer";

export type RemoteRichTextOptions = {
  publicProjectId: string;
  coreVersion: string;
  bucket: string;
  schema: SerializedImageSchema;
  remoteHost: string;
};
type RTFiles = Record<
  string,
  {
    value: string;
    filePathOrRef: string;
    patchPaths: string[][];
    metadata: {
      mimeType: string;
      height: number;
      width: number;
      alt?: string;
    };
  }
>;
export function remirrorToRichTextSource(
  node: RemirrorJSON,
  configDirectory: ConfigDirectory,
  remoteOptions: RemoteRichTextOptions | null,
): {
  blocks: RichTextSource<AllRichTextOptions>;
  files: RTFiles;
} {
  const files: RTFiles = {};
  const blocks: BlockNode<AllRichTextOptions>[] = [];
  let i = 0;
  for (const child of node?.content || []) {
    const block = convertBlock(
      [(i++).toString()],
      child,
      files,
      configDirectory,
      remoteOptions,
    );
    blocks.push(block);
  }
  return { blocks, files };
}

function convertBlock(
  path: string[],
  node: RemirrorJSON["content"][number],
  files: RTFiles,
  configDirectory: ConfigDirectory,
  remoteOptions: RemoteRichTextOptions | null,
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
            configDirectory,
            remoteOptions,
          ),
        ) || [],
    };
  } else if (node.type === "paragraph") {
    return convertParagraph(path, node, files, configDirectory, remoteOptions);
  } else if (node.type === "bulletList") {
    return convertBulletList(path, node, files, configDirectory, remoteOptions);
  } else if (node.type === "orderedList") {
    return convertOrderedList(
      path,
      node,
      files,
      configDirectory,
      remoteOptions,
    );
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
  files: RTFiles,
  configDirectory: ConfigDirectory,
  remoteOptions: RemoteRichTextOptions | null,
): HeadingNode<AllRichTextOptions>["children"][number] {
  if (node.type === "text") {
    return convertTextNode(node);
  } else if (node.type === "hardBreak") {
    return {
      tag: "br",
    };
  } else if (node.type === "image") {
    return convertImageNode(path, node, files, configDirectory, remoteOptions);
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
  files: RTFiles,
  configDirectory: ConfigDirectory,
  remoteOptions: RemoteRichTextOptions | null,
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
            configDirectory,
            remoteOptions,
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
  files: RTFiles,
  configDirectory: ConfigDirectory,
  remoteOptions: RemoteRichTextOptions | null,
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
              configDirectory,
              remoteOptions,
            );
          } else if (child.type === "bulletList") {
            return convertBulletList(
              path.concat("children", i.toString()),
              child,
              files,
              configDirectory,
              remoteOptions,
            );
          } else if (child.type === "orderedList") {
            return convertOrderedList(
              path.concat("children", i.toString()),
              child,
              files,
              configDirectory,
              remoteOptions,
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
  files: RTFiles,
  configDirectory: ConfigDirectory,
  remoteOptions: RemoteRichTextOptions | null,
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
            configDirectory,
            remoteOptions,
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
  files: RTFiles,
  configDirectory: ConfigDirectory,
  remoteOptions: RemoteRichTextOptions | null,
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
            configDirectory,
            remoteOptions,
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

const convertToNumber = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  const parsedValue = parseInt(value, 10);
  return isNaN(parsedValue) ? 0 : parsedValue;
};

const textEncoder = new TextEncoder();
function convertImageNode(
  path: string[],
  node: RemirrorImage,
  files: RTFiles,
  configDirectory: ConfigDirectory,
  remoteOptions: RemoteRichTextOptions | null,
): ImageNode<AllRichTextOptions> {
  if (node.attrs && node.attrs.src.startsWith("data:")) {
    const binaryData = Buffer.from(node.attrs.src.split(",")[1], "base64");
    const fullFileHash = Internal.getSHA256Hash(new Uint8Array(binaryData));
    const mimeType = Internal.getMimeType(node.attrs.src);
    if (mimeType === undefined) {
      throw new Error(
        `Could not detect Mime Type for image: ${node.attrs.src}`,
      );
    }
    const fileName = Internal.createFilename(
      node.attrs.src,
      node.attrs.fileName || "",
      {
        width: typeof node.attrs.width === "number" ? node.attrs.width : 0,
        height: typeof node.attrs.height === "number" ? node.attrs.height : 0,
        mimeType,
      },
      fullFileHash,
    );
    const dir = configDirectory?.endsWith("/")
      ? configDirectory
      : `${configDirectory}/`;
    const filePath = `${dir}${fileName}`;
    const existingFilesEntry = files[filePath];
    const thisPath = path
      // file is added as src (see below):
      .concat("src");
    const remoteFileHash = Internal.remote.hashToRemoteFileHash(fullFileHash);
    const ref = remoteOptions
      ? Internal.remote.createRemoteRef(remoteOptions.remoteHost, {
          ...remoteOptions,
          fileHash: remoteFileHash,
          validationHash: Internal.remote.getValidationHash(
            remoteOptions.coreVersion,
            remoteOptions.schema,
            mimeType,
            {
              width:
                typeof node.attrs.width === "number" ? node.attrs.width : 0,
              height:
                typeof node.attrs.height === "number" ? node.attrs.height : 0,
            },
            remoteFileHash,
            textEncoder,
          ),
          filePath: filePath.slice(1) as `public/val/${string}`,
        })
      : (filePath as `/public/${string}`);
    if (existingFilesEntry) {
      existingFilesEntry.patchPaths.push(thisPath);
    } else {
      // TODO: use ref instead on filePath?
      files[filePath] = {
        value: node.attrs.src,
        filePathOrRef: ref,
        metadata: {
          height: convertToNumber(node.attrs.height),
          width: convertToNumber(node.attrs.width),
          mimeType,
        },
        patchPaths: [thisPath],
      };
    }

    return {
      tag: "img",
      src: {
        [FILE_REF_PROP]: ref,
        ...(remoteOptions
          ? {
              [VAL_EXTENSION]: "remote" as const,
            }
          : {
              [VAL_EXTENSION]: "file" as const,
              [FILE_REF_SUBTYPE_TAG]: "image" as const,
            }),
        metadata: {
          width: typeof node.attrs.width === "number" ? node.attrs.width : 0,
          height: typeof node.attrs.height === "number" ? node.attrs.height : 0,
          mimeType,
        },
      },
    };
  } else if (node.attrs) {
    const url = node.attrs.src;
    const patchId = getParam("patch_id", url);
    let noParamsUrl = url.split("?")[0];
    let remote = false;
    if (patchId) {
      remote = getParam("remote", url) === "true";
      if (remote) {
        const remoteRef = getParam("ref", url);
        if (remoteRef) {
          noParamsUrl = decodeURIComponent(remoteRef);
        } else {
          console.error("Remote image URL does not contain ref: " + url);
        }
      } else if (noParamsUrl.startsWith("/api/val/files/public")) {
        noParamsUrl = noParamsUrl.slice("/api/val/files".length);
      } else {
        console.error(
          "Patched image URL does not start with /api/val/files: " + url,
        );
      }
    } else {
      if (remoteOptions && noParamsUrl.startsWith(remoteOptions.remoteHost)) {
        remote = true;
      } else if (!noParamsUrl.startsWith("/public")) {
        noParamsUrl = `/public${noParamsUrl}`;
      } else {
        console.error("Unpatched image URL starts with /public: " + url);
      }
    }
    const tag: ImageNode<AllRichTextOptions> = {
      tag: "img" as const,
      src: {
        ...(remote
          ? {
              [VAL_EXTENSION]: "remote" as const,
              [FILE_REF_PROP]: noParamsUrl,
            }
          : {
              [VAL_EXTENSION]: "file" as const,
              [FILE_REF_SUBTYPE_TAG]: "image" as const,
              [FILE_REF_PROP]: noParamsUrl as `/public/${string}`,
            }),
        metadata: {
          width: typeof node.attrs.width === "number" ? node.attrs.width : 0,
          height: typeof node.attrs.height === "number" ? node.attrs.height : 0,
          mimeType:
            (noParamsUrl && Internal.filenameToMimeType(noParamsUrl)) || "",
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
