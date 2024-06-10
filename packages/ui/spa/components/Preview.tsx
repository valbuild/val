import {
  Json,
  JsonObject,
  JsonArray,
  SerializedSchema,
  RichTextNode,
  VAL_EXTENSION,
  FILE_REF_PROP,
  FileSource,
  Internal,
  SerializedObjectSchema,
  AllRichTextOptions,
} from "@valbuild/core";
import { isJsonArray } from "../utils/isJsonArray";
import React, { createElement, useState } from "react";
import { createPortal } from "react-dom";
import { useValImagePreviewContext } from "./ValCompositeFields";

export function Preview({
  source,
  schema,
}: {
  source: Json;
  schema?: SerializedSchema; // TODO: use schema: if this is a string we want to be able to directly edit - maybe there's other thing we want to do?
}) {
  if (source === null) {
    return <PreviewEmpty />;
  }
  if (typeof source === "object") {
    if (isJsonArray(source)) {
      return <PreviewArray source={source} />;
    } else {
      if (schema?.type === "richtext") {
        return <PreviewRichText source={source} />;
      }
      if (schema?.type === "image") {
        return <PreviewImage source={source} />;
      }
      // schema might be a file or the object is representing some sort of file:
      if (schema?.type === "file" || source[VAL_EXTENSION] === "file") {
        return <PreviewFile source={source} />;
      }
      if (schema?.type === "object") {
        return <PreviewObject source={source} schema={schema} />;
      }
      if (schema?.type === "record") {
        return <PreviewRecord source={source} />;
      }
      // fall back to unknown object
      return <PreviewObject source={source} />;
    }
  }
  return <span className="min-h-6">{source.toString()}</span>;
}

function PreviewEmpty() {
  return <span className="text-accent">Empty</span>;
}

function PreviewObject({
  source,
  schema,
}: {
  source: JsonObject;
  schema?: SerializedObjectSchema;
}) {
  const keys = (schema && Object.keys(schema?.items)) || Object.keys(source);
  return (
    <div className="grid grid-cols-[min-content,auto] text-left">
      {keys.map((key) => {
        return (
          <div key={key} className="grid col-span-2 gap-1 grid-cols-subgrid">
            <span className="font-serif text-accent">{key}:</span>
            <Preview source={source[key] ?? null} schema={schema?.items[key]} />
          </div>
        );
      })}
    </div>
  );
}

function PreviewArray({ source }: { source: JsonArray }) {
  return (
    <span>
      {source.length === 0 && <span>No</span>}
      {source.length > 0 && (
        <span className="text-accent">{source.length}</span>
      )}
      <span>{source.length === 1 ? " item" : " items"}</span>
    </span>
  );
}

function PreviewRecord({ source }: { source: JsonObject }) {
  const keys = Object.keys(source);
  return (
    <span>
      {keys.length === 0 && <span>No</span>}
      {keys.length > 0 && <span className="text-accent">{keys.length}</span>}
      <span>{source.length === 1 ? " item" : " items"}</span>
    </span>
  );
}

function PreviewFile({ source }: { source: JsonObject }) {
  if (!(FILE_REF_PROP in source && typeof source[FILE_REF_PROP] === "string")) {
    return <span className="text-destructive">Invalid File</span>;
  }
  return (
    <a href={Internal.convertFileSource(source as FileSource).url}>
      {source[FILE_REF_PROP]}
    </a>
  );
}

function PreviewImage(
  props:
    | { source: JsonObject }
    | {
        src: string;
        alt?: string;
      }
) {
  const [isMouseOver, setIsMouseOver] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const hoverElem = useValImagePreviewContext()?.hoverElem;

  let url;
  let text: string;
  if ("source" in props) {
    if (
      !(
        FILE_REF_PROP in props.source &&
        typeof props.source[FILE_REF_PROP] === "string"
      )
    ) {
      return <span className="text-destructive">Invalid Image</span>;
    }
    url = Internal.convertFileSource(props.source as FileSource).url;
    text = props.source[FILE_REF_PROP];
  } else {
    url = props.src;
    text = props.alt || url;
  }

  return (
    <span
      onMouseOver={(ev) => {
        setIsMouseOver({
          x: ev.clientX,
          y: ev.clientY,
        });
      }}
      onMouseLeave={() => {
        setIsMouseOver(null);
      }}
      className="relative flex items-center justify-start gap-1"
    >
      <a href={url} className="overflow-hidden underline truncate ">
        {text}
      </a>
      {isMouseOver &&
        hoverElem &&
        createPortal(
          <img
            className="absolute z-[5] max-w-[10vw]"
            style={{
              left: isMouseOver.x + 10,
              top: isMouseOver.y + 10,
            }}
            src={url}
          ></img>,
          hoverElem
        )}
    </span>
  );
}

// #region RichText
export function PreviewRichText({ source: source }: { source: JsonObject }) {
  if (
    !("templateStrings" in source && "exprs" in source) ||
    source[VAL_EXTENSION] !== "richtext"
  ) {
    return <span className="text-destructive">Invalid RichText</span>;
  }
  let rootChildren: RichTextNode<AllRichTextOptions>[] = [];
  if (Array.isArray(source)) {
    rootChildren = source;
  } else {
    console.warn("Invalid RichText source", source);
  }
  function build(
    node: RichTextNode<AllRichTextOptions>,
    key: number
  ): React.ReactElement {
    if (typeof node === "string") {
      return <span key={key}>{node}</span>;
    }
    if (node.tag === "p") {
      return <p key={key}>{node.children.map(build)}</p>;
    }
    if (
      node.tag === "h1" ||
      node.tag === "h2" ||
      node.tag === "h3" ||
      node.tag === "h4" ||
      node.tag === "h5" ||
      node.tag === "h6"
    ) {
      return (
        <span key={key} className="font-bold text-accent">
          {node.children.map(build)}
        </span>
      );
    }
    if (node.tag === "a") {
      return (
        <span key={key} className="underline text-accent">
          {node.children.map(build)}
        </span>
      );
    }
    if (node.tag === "img") {
      return <PreviewImage key={key} src={node.children[0][FILE_REF_PROP]} />;
    }
    if (node.tag === "br") {
      return <br key={key} />;
    }

    return createElement(node.tag, {
      key,
      children: node.children.map(build),
    });
  }

  return (
    <span>
      {rootChildren.map((child, i) => {
        return build(child, i);
      })}
    </span>
  );
}
// #endregion RichText
