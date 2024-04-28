import {
  Json,
  JsonObject,
  JsonArray,
  SerializedSchema,
  AnyRichTextOptions,
  RichText,
  RichTextNode,
  SourcePath,
  VAL_EXTENSION,
  RichTextSource,
} from "@valbuild/core";
import { isJsonArray } from "../utils/isJsonArray";
import React from "react";
import { parseRichTextSource } from "@valbuild/shared/internal";

export function Preview({
  source,
  schema,
}: {
  source: Json;
  schema: SerializedSchema; // TODO: use schema: if this is a string we want to be able to directly edit - maybe there's other thing we want to do?
}) {
  if (source === null) {
    return <div className="text-accent">Empty</div>;
  }

  if (typeof source === "object") {
    if (isJsonArray(source)) {
      return <PreviewArray source={source} />;
    } else {
      if (source[VAL_EXTENSION] === "richtext" && "children" in source) {
        return (
          <PreviewRichText>
            {parseRichTextSource(source as RichTextSource<AnyRichTextOptions>)}
          </PreviewRichText>
        );
      }
      return <PreviewObject source={source} schema={schema} />;
    }
  }
  return <span>{source.toString()}</span>;
}

function PreviewObject({
  source,
  schema,
}: {
  source: JsonObject;
  schema: SerializedSchema;
}) {
  return (
    <div>
      {Object.keys(source).map((key) => {
        return (
          <div key={key} className="grid grid-cols-[auto,1fr] gap-4">
            <div className="font-serif text-accent">{key}:</div>
            <Preview source={source[key] ?? null} schema={schema} />
          </div>
        );
      })}
    </div>
  );
}

function PreviewArray({ source }: { source: JsonArray }) {
  return (
    <span>
      <span className="text-accent">{source.length}</span>
      <span>{source.length === 1 ? " item" : " items"}</span>
    </span>
  );
}

// #region RichText
const theme: { tags: Record<string, string>; classes: Record<string, string> } =
  {
    tags: {
      h1: "font-bold",
      h2: "font-bold",
      h3: "font-bold",
      h4: "font-bold",
      h5: "font-bold",
      h6: "font-bold",
      p: "",
    },
    classes: {
      bold: "font-bold",
      italic: "italic",
      lineThrough: "line-through",
    },
  };
export function PreviewRichText({
  children,
}: {
  children: RichText<AnyRichTextOptions>;
}) {
  const root = children as RichText<AnyRichTextOptions> & {
    valPath: SourcePath;
  };
  function withRenderTag(clazz: string, current?: string) {
    const renderClass = theme.tags[clazz];
    if (renderClass && current) {
      return [current, renderClass].join(" ");
    }
    if (renderClass) {
      return renderClass;
    }
    return current;
  }
  function withRenderClass(clazz: string, current?: string) {
    const renderClass = theme.classes[clazz];
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
          {node.children.map((child, key) => toReact(child, key))}
        </p>
      );
    }
    if (node.tag === "img") {
      return <img className={withRenderTag("img")} key={key} src={node.src} />;
    }
    if (node.tag === "ul") {
      return (
        <ul className={withRenderTag("ul")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </ul>
      );
    }
    if (node.tag === "ol") {
      return (
        <ol className={withRenderTag("ol")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </ol>
      );
    }
    if (node.tag === "li") {
      return (
        <li className={withRenderTag("li")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
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
          {node.children.map((child, key) => toReact(child, key))}
        </span>
      );
    }
    if (node.tag === "h1") {
      return (
        <h1 className={withRenderTag("h1")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </h1>
      );
    }
    if (node.tag === "h2") {
      return (
        <h2 className={withRenderTag("h2")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </h2>
      );
    }
    if (node.tag === "h3") {
      return (
        <h3 className={withRenderTag("h3")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </h3>
      );
    }
    if (node.tag === "h4") {
      return (
        <h4 className={withRenderTag("h4")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </h4>
      );
    }
    if (node.tag === "h5") {
      return (
        <h5 className={withRenderTag("h5")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </h5>
      );
    }
    if (node.tag === "h6") {
      return (
        <h6 className={withRenderTag("h6")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </h6>
      );
    }

    if (node.tag === "br") {
      return <br key={key} />;
    }
    if (node.tag === "a") {
      return (
        <a href={node.href} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </a>
      );
    }
    console.error("Unknown tag", node.tag);
    const _exhaustiveCheck: never = node.tag;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyNode = _exhaustiveCheck as any;
    if (!anyNode?.tag) {
      return null;
    }
    return React.createElement(anyNode.tag, {
      key,
      className: anyNode.class?.join(" "),
      children: anyNode.children?.map(toReact),
    });
  }

  return (
    <span data-val-path={root.valPath}>
      {root.children.map((child, i) => {
        return toReact(child, i);
      })}
    </span>
  );
}
// #endregion RichText
