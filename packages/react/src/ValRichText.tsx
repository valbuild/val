/* eslint-disable @typescript-eslint/ban-types */
import {
  RichText,
  RichTextNode,
  AnyRichTextOptions,
  SourcePath,
  RichTextOptions,
} from "@valbuild/core";
import React from "react";

// Pick is used to make sure we do not add a tag or class that is not in options:
type Tags = keyof Pick<RichTextOptions, "img" | "ul" | "ol">;
type Classes = keyof Pick<RichTextOptions, "bold" | "italic" | "lineThrough">;

type RenderOptions<O extends RichTextOptions> = {
  tags: (O["headings"] extends Array<unknown>
    ? {
        [Key in O["headings"][number]]: string;
      }
    : {}) & {
    [Key in Tags & keyof O as O[Key] extends true
      ? Key extends "ul" | "ol"
        ? Key | "li"
        : Key
      : never]: string;
  } & { p?: string };
  classes: {
    [Key in Classes & keyof O as O[Key] extends true ? Key : never]: string;
  } & (O["img"] extends true ? { imgContainer?: string } : {});
};

export function ValRichText<O extends RichTextOptions>({
  render,
  children,
}: {
  render: RenderOptions<O>;
  children: RichText<O>;
}) {
  const root = children as RichText<AnyRichTextOptions> & {
    valPath: SourcePath;
  };
  function withRenderTag(
    clazz: keyof RenderOptions<AnyRichTextOptions>["tags"],
    current?: string
  ) {
    const renderClass = (render as any).tags[clazz];
    if (renderClass && current) {
      return [current, renderClass].join(" ");
    }
    if (renderClass) {
      return renderClass;
    }
    return current;
  }
  function withRenderClass(
    clazz: keyof RenderOptions<AnyRichTextOptions>["classes"],
    current?: string
  ) {
    const renderClass = (render as any).classes[clazz];
    if (renderClass && current) {
      return [current, renderClass].join(" ");
    }
    if (renderClass) {
      return renderClass;
    }
    return current;
  }

  function toReact(
    node: RichTextNode<AnyRichTextOptions>,
    key: number | string
  ): React.ReactNode {
    if (typeof node === "string") {
      return node;
    }
    if (node.tag === "p") {
      return (
        <p className={withRenderTag("p")} key={key}>
          {node.children.map(toReact)}
        </p>
      );
    }
    if (node.tag === "img") {
      return (
        <div className={withRenderClass("imgContainer")} key={key}>
          <img className={withRenderTag("img")} src={node.src} />
        </div>
      );
    }
    // if (node.tag === "blockquote") {
    //   return <blockquote key={key}>{node.children.map(toReact)}</blockquote>;
    // }
    if (node.tag === "ul") {
      return (
        <ul className={withRenderTag("ul")} key={key}>
          {node.children.map(toReact)}
        </ul>
      );
    }
    if (node.tag === "ol") {
      return (
        <ol className={withRenderTag("ol")} key={key}>
          {node.children.map(toReact)}
        </ol>
      );
    }
    if (node.tag === "li") {
      return (
        <li className={withRenderTag("li")} key={key}>
          {node.children.map(toReact)}
        </li>
      );
    }
    if (node.tag === "span") {
      return (
        <span
          key={key}
          className={node.classes
            .map((nodeClass) => {
              switch (nodeClass) {
                case "bold":
                  return withRenderClass("bold");
                case "line-through":
                  return withRenderClass("lineThrough");
                case "italic":
                  return withRenderClass("italic");
              }
            })
            .join(" ")}
        >
          {node.children.map(toReact)}
        </span>
      );
    }
    if (node.tag === "h1") {
      return (
        <h1 className={withRenderTag("h1")} key={key}>
          {node.children.map(toReact)}
        </h1>
      );
    }
    if (node.tag === "h2") {
      return (
        <h2 className={withRenderTag("h2")} key={key}>
          {node.children.map(toReact)}
        </h2>
      );
    }
    if (node.tag === "h3") {
      return (
        <h3 className={withRenderTag("h3")} key={key}>
          {node.children.map(toReact)}
        </h3>
      );
    }
    if (node.tag === "h4") {
      return (
        <h4 className={withRenderTag("h4")} key={key}>
          {node.children.map(toReact)}
        </h4>
      );
    }
    if (node.tag === "h5") {
      return (
        <h5 className={withRenderTag("h5")} key={key}>
          {node.children.map(toReact)}
        </h5>
      );
    }
    if (node.tag === "h6") {
      return (
        <h6 className={withRenderTag("h6")} key={key}>
          {node.children.map(toReact)}
        </h6>
      );
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
