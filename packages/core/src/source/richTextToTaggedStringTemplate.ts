/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AnyRichTextOptions,
  FileSource,
  RichTextNode,
  RichTextSource,
} from "@valbuild/core";
import { ImageMetadata } from "../schema/image";
import { LinkSource } from "./link";

const HeaderRegEx = /^h([\d+])$/;

export function richTextToTaggedStringTemplate(
  source: RichTextSource<AnyRichTextOptions>
) {
  return transformRichTextChildren(source.children);
}

function transformRichTextChildren(
  source: RichTextNode<AnyRichTextOptions, "source">[]
): [string[], (FileSource<ImageMetadata> | LinkSource)[]] {
  const texts: string[] = [""];
  const nodes: any[] = [];
  let didAppendNewLines = false;
  let listContext: "ul" | "ol" | null = null;

  function rec(node: RichTextNode<AnyRichTextOptions, "source">) {
    if (typeof node === "string") {
      texts[texts.length - 1] += node;
    } else if ("tag" in node && node.tag) {
      if (
        node.tag === "h1" ||
        node.tag === "h2" ||
        node.tag === "h3" ||
        node.tag === "h4" ||
        node.tag === "h5" ||
        node.tag === "h6"
      ) {
        const depth = Number(node.tag.match(HeaderRegEx)?.[1]);
        if (Number.isNaN(depth)) {
          throw new Error("Invalid header depth");
        }
        for (let i = 0; i < Number(depth); i++) {
          texts[texts.length - 1] += "#";
        }
        texts[texts.length - 1] += " ";
      } else if (node.tag === "p") {
        // Ignore
      } else if (node.tag === "ul") {
        listContext = "ul";
        texts[texts.length - 1] += "\n";
      } else if (node.tag === "ol") {
        listContext = "ol";
        texts[texts.length - 1] += "\n";
      } else if (node.tag === "li") {
        if (listContext === "ul") {
          texts[texts.length - 1] += "\n- ";
        } else if (listContext === "ol") {
          texts[texts.length - 1] += "\n1. ";
        } else {
          throw new Error("Unexpected list context");
        }
      } else if (node.tag === "span") {
        if (node.classes.includes("bold") && !node.classes.includes("italic")) {
          texts[texts.length - 1] += "**";
        }
        if (node.classes.includes("italic") && !node.classes.includes("bold")) {
          texts[texts.length - 1] += "*";
        }
        if (node.classes.includes("italic") && node.classes.includes("bold")) {
          texts[texts.length - 1] += "***";
        }
        if (node.classes.includes("line-through")) {
          texts[texts.length - 1] += "~~";
        }
      } else if (node.tag === "br") {
        texts[texts.length - 1] += "<br/>";
      } else {
        //exhaustive match
        const exhaustiveCheck: never = node.tag;
        throw new Error(
          "Unexpected node tag: " + JSON.stringify(node, exhaustiveCheck, 2)
        );
      }

      node.children?.forEach(rec);

      didAppendNewLines = false;
      if (node.tag === "span") {
        if (node.classes.includes("line-through")) {
          texts[texts.length - 1] += "~~";
        }
        if (node.classes.includes("italic") && node.classes.includes("bold")) {
          texts[texts.length - 1] += "***";
        }
        if (node.classes.includes("italic") && !node.classes.includes("bold")) {
          texts[texts.length - 1] += "*";
        }
        if (node.classes.includes("bold") && !node.classes.includes("italic")) {
          texts[texts.length - 1] += "**";
        }
      } else if (node.tag === "p" || node.tag === "br") {
        didAppendNewLines = true;
        texts[texts.length - 1] += "\n\n";
      } else if (node.tag === "ul" || node.tag === "ol") {
        listContext = null;
        texts[texts.length - 1] += "\n";
      } else if (node.tag?.startsWith("h")) {
        didAppendNewLines = true;
        texts[texts.length - 1] += "\n\n";
      }
    } else {
      if (node._type === "link") {
        const [t, n] = transformRichTextChildren(node.children);
        texts.push("");
        nodes.push({
          ...node,
          children: t,
        });
        if (n.length > 0) {
          throw new Error(`Unexpected nodes in link: ${JSON.stringify(node)}`);
        }
      } else if (node._type === "file") {
        nodes.push(node);
        texts.push("\n");
      } else {
        // exhaustive
        const exhaustiveCheck: never = node;
        throw new Error(
          "Unexpected node tag: " + JSON.stringify(node, exhaustiveCheck, 2)
        );
      }
    }
  }
  source.forEach(rec);

  if (texts[texts.length - 1] && didAppendNewLines) {
    // remove last \n\n
    texts[texts.length - 1] = texts[texts.length - 1].slice(0, -2);
  }
  return [texts, nodes];
}
