/* eslint-disable @typescript-eslint/no-explicit-any */
import { AnyRichTextOptions, RichTextSource } from "@valbuild/core";

const HeaderRegEx = /h([\d])/;

export function richTextToTaggedStringTemplate(
  source: RichTextSource<AnyRichTextOptions>
) {
  const texts: string[] = [""];
  const nodes: any[] = [];
  let didAppendNewLines = false;

  function rec(node: any) {
    if (typeof node === "string") {
      texts[texts.length - 1] += node;
    } else if (node.tag) {
      if (node.tag?.startsWith("h")) {
        const [, depth] = node.tag.match(HeaderRegEx);
        for (let i = 0; i < Number(depth); i++) {
          texts[texts.length - 1] += "#";
        }
        texts[texts.length - 1] += " ";
      } else if (node.tag === "span") {
        if (
          node.class.includes("font-bold") &&
          !node.class.includes("italic")
        ) {
          texts[texts.length - 1] += "**";
        }
        if (
          node.class.includes("italic") &&
          !node.class.includes("font-bold")
        ) {
          texts[texts.length - 1] += "*";
        }
        if (node.class.includes("italic") && node.class.includes("font-bold")) {
          texts[texts.length - 1] += "***";
        }
        if (node.class.includes("line-through")) {
          texts[texts.length - 1] += "~~";
        }
      }

      node.children?.forEach(rec);

      if (node.tag === "span") {
        didAppendNewLines = false;
        if (
          node.class.includes("font-bold") &&
          !node.class.includes("italic")
        ) {
          texts[texts.length - 1] += "**";
        }
        if (
          node.class.includes("italic") &&
          !node.class.includes("font-bold")
        ) {
          texts[texts.length - 1] += "*";
        }
        if (node.class.includes("italic") && node.class.includes("font-bold")) {
          texts[texts.length - 1] += "***";
        }
        if (node.class.includes("line-through")) {
          texts[texts.length - 1] += "~~";
        }
      } else if (node.tag === "p") {
        didAppendNewLines = true;
        texts[texts.length - 1] += "\n\n";
      } else if (node.tag?.startsWith("h")) {
        didAppendNewLines = true;
        texts[texts.length - 1] += "\n\n";
      }
    } else {
      nodes.push(node);
      texts.push("\n");
    }
  }
  source.children.forEach(rec);

  if (texts[texts.length - 1] && didAppendNewLines) {
    // remove last \n\n
    texts[texts.length - 1] = texts[texts.length - 1].slice(0, -2);
  }
  return [texts, nodes];
}
