import { RichText, RichTextNode, SourcePath } from "@valbuild/core";
import React from "react";

export function ValRichText({ children }: { children: RichText }) {
  const root = children as RichText & { valPath: SourcePath };

  function toReact(node: RichTextNode, key: number | string): React.ReactNode {
    if (typeof node === "string") {
      return node;
    }
    if (node.tag === "p") {
      return <p key={key}>{node.children.map(toReact)}</p>;
    }
    if (node.tag === "img") {
      return (
        <div key={key}>
          <img src={node.src} />
        </div>
      );
    }
    if (node.tag === "blockquote") {
      return <blockquote key={key}>{node.children.map(toReact)}</blockquote>;
    }
    if (node.tag === "ul") {
      return <ul key={key}>{node.children.map(toReact)}</ul>;
    }
    if (node.tag === "ol") {
      return <ol key={key}>{node.children.map(toReact)}</ol>;
    }
    if (node.tag === "li") {
      return <li key={key}>{node.children.map(toReact)}</li>;
    }
    if (node.tag === "span") {
      return (
        <span key={key} className={node.class.join(" ")}>
          {node.children.map(toReact)}
        </span>
      );
    }
    if (node.tag === "h1") {
      return <h1 key={key}>{node.children.map(toReact)}</h1>;
    }
    if (node.tag === "h2") {
      return <h2 key={key}>{node.children.map(toReact)}</h2>;
    }
    if (node.tag === "h3") {
      return <h3 key={key}>{node.children.map(toReact)}</h3>;
    }
    if (node.tag === "h4") {
      return <h4 key={key}>{node.children.map(toReact)}</h4>;
    }
    if (node.tag === "h5") {
      return <h5 key={key}>{node.children.map(toReact)}</h5>;
    }
    if (node.tag === "h6") {
      return <h6 key={key}>{node.children.map(toReact)}</h6>;
    }
    console.error("Unknown tag", node.tag);
    const anyNode = node as any;
    return React.createElement(anyNode.tag, {
      key,
      className: anyNode.class?.join(" "),
      children: anyNode.children.map(toReact),
    });
  }

  return <div data-val-path={root.valPath}>{root.children.map(toReact)}</div>;
}
