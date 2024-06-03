import {
  SourcePath,
  Json,
  SerializedSchema,
  ModuleFilePath,
  JsonObject,
  SerializedObjectSchema,
  SerializedRecordSchema,
  JsonArray,
  SerializedArraySchema,
  Internal,
  VAL_EXTENSION,
  RichTextSource,
  AnyRichTextOptions,
  FILE_REF_PROP,
  FileSource,
  ImageMetadata,
  RichText,
  RichTextNode,
  ModulePath,
} from "@valbuild/core";
import { parseRichTextSource } from "@valbuild/shared/internal";
import classNames from "classnames";
import React, { useState, useEffect, Fragment } from "react";
import { createPortal } from "react-dom";
import { ValFormField, FieldContainer, InitOnSubmit } from "./ValFormField";
import { Card } from "./ui/card";
import { Path } from "./Path";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { JSONValue, Patch } from "@valbuild/core/patch";
import { array } from "@valbuild/core/fp";
import { useNavigate } from "./ValRouter";
import { isJsonArray } from "../utils/isJsonArray";
import { SortableList } from "./SortableList";
import { emptyOf } from "./emptyOf";
import { SubmitStatus } from "./SubmitStatus";
import { Checkbox } from "./ui/checkbox";

export function AnyVal({
  path,
  source,
  schema,
  field,
  initOnSubmit,
  top,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  field?: string;
  initOnSubmit: InitOnSubmit;
  top?: boolean;
}): React.ReactElement {
  if (schema.opt) {
    return (
      <ValNullable
        path={path}
        source={source}
        schema={schema}
        field={field}
        initOnSubmit={initOnSubmit}
      />
    );
  }
  if (source === null) {
    return (
      <ValDefaultOf
        source={source}
        schema={schema}
        path={path}
        initOnSubmit={initOnSubmit}
      />
    );
  }
  if (schema.type === "object") {
    if (typeof source !== "object" || isJsonArray(source)) {
      return <div>ERROR: expected object, but found {typeof source}</div>;
    }
    return (
      <div>
        {field && <div className="text-left">{field}</div>}
        <ValObject
          source={source}
          path={path}
          schema={schema}
          initOnSubmit={initOnSubmit}
          top={top}
        />
      </div>
    );
  } else if (schema.type === "array") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return <div>ERROR: expected array, but found {typeof source}</div>;
    }
    return (
      <div>
        {field && <div className="text-left">{field}</div>}
        <ValList
          source={source}
          path={path}
          schema={schema}
          initOnSubmit={initOnSubmit}
        />
      </div>
    );
  } else if (schema.type === "record") {
    if (typeof source !== "object") {
      return (
        <div>
          ERROR: expected object for {schema.type}, but found {typeof source}
        </div>
      );
    }
    if (isJsonArray(source)) {
      return <div>ERROR: did not expect array for {schema.type}</div>;
    }
    return (
      <div>
        {field && <div className="text-left">{field}</div>}
        <ValRecord source={source} path={path} schema={schema} />
      </div>
    );
  } else if (schema?.type === "union") {
    if (
      typeof schema.key === "string" &&
      typeof source === "object" &&
      !isJsonArray(source)
    ) {
      return (
        <ValTaggedUnion
          field={field}
          source={source}
          path={path}
          schema={
            schema as {
              type: "union";
              key: string;
              items: SerializedSchema[];
              opt: boolean;
            }
          }
          initOnSubmit={initOnSubmit}
          top={top}
        />
      );
    }
  } else if (schema?.type === "literal") {
    return <></>; // skip literals
  }

  return (
    <div className="py-2 gap-y-4">
      {field && <div className="text-left">{field}</div>}
      <ValFormField
        path={path}
        source={source}
        schema={schema}
        initOnSubmit={initOnSubmit}
      />
    </div>
  );
}

function ValTaggedUnion({
  field,
  path,
  source,
  schema,
  initOnSubmit,
  top,
}: {
  field?: string;
  source: JsonObject;
  path: SourcePath;
  schema: {
    type: "union";
    key: string;
    items: SerializedSchema[];
    opt: boolean;
  };
  initOnSubmit: InitOnSubmit;
  top?: boolean;
}) {
  const keys = getKeysOfUnionObject(schema);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [currentSourceAndSchema, setCurrentSourceAndSchema] = useState<{
    source: Json | null;
    schema: SerializedSchema;
  } | null>(null);
  useEffect(() => {
    const key = source[schema.key];
    if (typeof key !== "string") {
      console.error("Expected key to be a string, but got", key);
      return;
    }
    setCurrentKey(key);
    for (const item of schema.items) {
      if (item.type === "object" && item.items[schema.key]) {
        const maybeLiteral = item.items[schema.key];
        if (maybeLiteral.type === "literal") {
          if (maybeLiteral.value === key) {
            setCurrentSourceAndSchema({
              schema: item,
              source,
            });
          }
        }
      }
    }
  }, [schema, source]);
  const [loading, setLoading] = useState<boolean>(false);
  const onSubmit = initOnSubmit(path);
  return (
    <FieldContainer
      key={path}
      className={classNames("flex flex-col gap-y-4", {
        "border-l-2 border-border pl-6": !top,
      })}
    >
      {(field || schema.key) && (
        <div className="text-left">{field || schema.key}</div>
      )}
      <Select
        value={currentKey ?? undefined}
        disabled={loading}
        onValueChange={(key) => {
          setCurrentKey(key);
          for (const item of schema.items) {
            if (item.type === "object" && item.items[schema.key]) {
              const maybeLiteral = item.items[schema.key];
              if (maybeLiteral.type === "literal") {
                if (maybeLiteral.value === key) {
                  const nextSource = {
                    ...Object.fromEntries(
                      Object.keys(item.items).map((key) => [
                        key,
                        emptyOf(item.items[key]),
                      ])
                    ),
                    [schema.key]: key,
                  };
                  setCurrentSourceAndSchema({
                    schema: item,
                    source: nextSource,
                  });
                  setLoading(true);
                  onSubmit(async (path) => {
                    return [
                      {
                        op: "replace",
                        path: path,
                        value: nextSource as JSONValue,
                      },
                    ];
                  }).finally(() => {
                    setLoading(false);
                  });
                  return;
                }
              }
            }
          }
          console.error("Could not find key", key);
        }}
      >
        <div className="relative pr-6">
          <SelectTrigger>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            {keys.map((tag) => (
              <SelectItem key={tag} value={tag.toString()}>
                {tag.toString()}
              </SelectItem>
            ))}
          </SelectContent>
          <div className="absolute top-2 -right-4">
            <SubmitStatus submitStatus={loading ? "loading" : "idle"} />
          </div>
        </div>
      </Select>
      {currentSourceAndSchema && (
        <AnyVal
          key={JSON.stringify(currentSourceAndSchema.schema)}
          path={path as SourcePath}
          source={currentSourceAndSchema.source}
          schema={currentSourceAndSchema.schema}
          initOnSubmit={initOnSubmit}
          top={top}
        />
      )}
    </FieldContainer>
  );
}

function getKeysOfUnionObject(schema: {
  type: "union";
  key: string;
  items: SerializedSchema[];
  opt: boolean;
}): string[] {
  const keys = [];
  for (const item of schema.items) {
    if (item.type === "object" && item.items[schema.key]) {
      const maybeLiteral = item.items[schema.key];
      if (maybeLiteral.type === "literal") {
        keys.push(maybeLiteral.value);
      }
    }
  }
  return keys;
}

function ValObject({
  path,
  source,
  schema,
  initOnSubmit,
  top,
}: {
  source: JsonObject;
  path: SourcePath;
  schema: SerializedObjectSchema;
  initOnSubmit: InitOnSubmit;
  top?: boolean;
}): React.ReactElement {
  return (
    <div
      key={path}
      className={classNames("flex flex-col gap-y-1", {
        "border-l-2 border-border pl-6": !top,
      })}
    >
      {Object.entries(schema.items).map(([key, property]) => {
        const subPath = createValPathOfItem(path, key);
        return (
          <AnyVal
            key={subPath}
            path={subPath}
            source={source?.[key] ?? null}
            schema={property}
            field={key}
            initOnSubmit={initOnSubmit}
          />
        );
      })}
    </div>
  );
}

function ValRecord({
  path,
  source,
  schema,
}: {
  source: JsonObject;
  path: SourcePath;
  schema: SerializedRecordSchema;
}): React.ReactElement {
  const navigate = useNavigate();
  return (
    <div key={path} className="flex flex-col gap-4 p-2">
      {Object.entries(source).map(([key, item]) => {
        const subPath = createValPathOfItem(path, key);
        return (
          <button
            key={subPath}
            onClick={() => {
              navigate(subPath);
            }}
          >
            <ValRecordItem
              recordKey={key}
              path={subPath}
              source={item}
              schema={schema.item}
            />
          </button>
        );
      })}
    </div>
  );
}

const RECORD_ITEM_MAX_HEIGHT = 170;
function ValRecordItem({
  recordKey,
  path,
  source,
  schema,
}: {
  recordKey: string;
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
}): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  useEffect(() => {
    if (ref.current) {
      const height = ref.current.getBoundingClientRect().height;
      if (height >= RECORD_ITEM_MAX_HEIGHT) {
        setIsTruncated(true);
      }
    }
  }, []);
  return (
    <Card
      key={path}
      ref={ref}
      className="relative px-4 pt-2 pb-4 overflow-hidden border gap-y-2"
      style={{
        maxHeight: RECORD_ITEM_MAX_HEIGHT,
      }}
    >
      <div className="pb-4 font-serif text-left text-accent">{recordKey}</div>
      <div className="text-xs">
        <ValPreview path={path} source={source} schema={schema} />
      </div>
      {isTruncated && (
        <div className="absolute bottom-0 left-0 w-full h-[20px] bg-gradient-to-b from-transparent to-background"></div>
      )}
    </Card>
  );
}

function ValList({
  path,
  source,
  schema,
  initOnSubmit,
}: {
  source: JsonArray;
  path: SourcePath;
  schema: SerializedArraySchema;
  initOnSubmit: InitOnSubmit;
}): React.ReactElement {
  const navigate = useNavigate();
  const onSubmit = initOnSubmit(path);
  const [loading, setLoading] = useState<boolean>(false);

  return (
    <FieldContainer key={path} className="flex flex-col gap-4 p-2 pb-8">
      <SortableList
        path={path}
        source={source}
        schema={schema}
        loading={loading}
        onDelete={async (item) => {
          setLoading(true);
          return onSubmit(async (path) => {
            return [
              {
                op: "remove",
                path: path.concat(
                  item.toString()
                ) as array.NonEmptyArray<string>,
              },
            ];
          })
            .catch((err) => {
              console.error("Could not delete item", err);
            })
            .finally(() => {
              setLoading(false);
            });
        }}
        onMove={async (from, to) => {
          return onSubmit(async (path) => {
            const fromPath = path.concat(from.toString());
            const toPath = path.concat(to.toString());
            return [
              {
                op: "move",
                from: fromPath,
                path: toPath,
              },
            ] as Patch;
          })
            .catch((err) => {
              console.error("Could not move item", err);
            })
            .finally(() => {
              setLoading(false);
            });
        }}
        onClick={(path) => {
          navigate(path);
        }}
      />
    </FieldContainer>
  );
}

function createValPathOfItem<S extends SourcePath | ModulePath>(
  arrayPath: S | undefined,
  prop: string | number | symbol
): S {
  const val = Internal.createValPathOfItem(arrayPath, prop);
  if (!val) {
    // Should never happen
    throw Error(
      `Could not create val path: ${arrayPath} of ${prop?.toString()}`
    );
  }
  return val as S;
}

function ValPreview({
  path,
  source,
  schema,
}: {
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
}): React.ReactElement {
  const [isMouseOver, setIsMouseOver] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const hoverElem = useValImagePreviewContext()?.hoverElem;

  if (schema.type === "object") {
    return (
      <div
        key={path}
        className="grid grid-cols-[min-content_1fr] gap-2 text-left"
      >
        {Object.entries(schema.items).map(([key]) => {
          return (
            <Fragment key={createValPathOfItem(path, key)}>
              <span className="text-muted">{key}:</span>
              <span>
                <ValPreview
                  source={(source as JsonObject | null)?.[key] ?? null}
                  schema={schema.items[key]}
                  path={createValPathOfItem(path, key)}
                />
              </span>
            </Fragment>
          );
        })}
      </div>
    );
  } else if (schema.type === "array") {
    if (source === null) {
      return (
        <span key={path} className="text-accent">
          Empty
        </span>
      );
    }
    if (Array.isArray(source)) {
      return (
        <span key={path}>
          <span className="text-accent">{source.length}</span>
          <span>{source.length === 1 ? " item" : " items"}</span>
        </span>
      );
    }
    return (
      <span
        key={path}
        className="px-2 bg-destructive text-destructive-foreground"
      >
        Unknown length
      </span>
    );
  } else if (schema.type === "richtext") {
    if (source === null) {
      return (
        <span key={path} className="text-accent">
          Empty
        </span>
      );
    }
    if (typeof source !== "object") {
      return (
        <div
          key={path}
          className="p-4 text-destructive-foreground bg-destructive"
        >
          ERROR: {typeof source} not an object
        </div>
      );
    }
    if (!(VAL_EXTENSION in source) || source[VAL_EXTENSION] !== "richtext") {
      return (
        <div
          key={path}
          className="p-4 text-destructive-foreground bg-destructive"
        >
          ERROR: object is not richtext
        </div>
      );
    }
    return (
      <ValRichText key={path}>
        {parseRichTextSource(source as RichTextSource<AnyRichTextOptions>)}
      </ValRichText>
    );
  } else if (schema.type === "string") {
    if (source === null) {
      return (
        <span key={path} className="text-accent">
          Empty
        </span>
      );
    }
    return <span>{source as string}</span>;
  } else if (schema.type === "image") {
    if (source === null) {
      return (
        <span key={path} className="text-accent">
          Empty
        </span>
      );
    }
    if (typeof source !== "object") {
      return (
        <div
          key={path}
          className="p-4 text-destructive-foreground bg-destructive"
        >
          ERROR: not an object
        </div>
      );
    }
    if (
      !(FILE_REF_PROP in source) ||
      typeof source[FILE_REF_PROP] !== "string"
    ) {
      return (
        <div
          key={path}
          className="p-4 text-destructive-foreground bg-destructive"
        >
          ERROR: object is not an image
        </div>
      );
    }
    const url = Internal.convertFileSource(
      source as FileSource<ImageMetadata>
    ).url;
    return (
      <span
        key={path}
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
          {source[FILE_REF_PROP]}
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
  } else if (schema.type === "boolean") {
    if (source === null) {
      return (
        <span key={path} className="text-accent">
          Empty
        </span>
      );
    }
    return (
      <span key={path} className="text-accent">
        {source ? "true" : "false"}
      </span>
    );
  } else if (schema.type === "number") {
    if (source === null) {
      return (
        <span key={path} className="text-accent">
          Empty
        </span>
      );
    }
    return <span className="text-accent">{source.toString()}</span>;
  } else if (schema.type === "keyOf") {
    if (source === null) {
      return (
        <span key={path} className="text-accent">
          Empty
        </span>
      );
    }
    return (
      <span key={path} className="text-accent">
        {source.toString()}
      </span>
    );
  }

  return <div key={path}>TODO: {schema.type}</div>;
}

function ValNullable({
  path,
  source,
  schema,
  initOnSubmit,
  field,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  initOnSubmit: InitOnSubmit;
  field?: string;
}) {
  const [enable, setEnable] = useState<boolean>(source !== null);
  const onSubmit = initOnSubmit(path);
  const [loading, setLoading] = useState<boolean>(false);
  useEffect(() => {
    setEnable(source !== null);
  }, [source]);

  return (
    <div className="flex flex-col gap-y-2" key={path}>
      <div className="relative flex items-center justify-between gap-x-4">
        <div
          className="truncate max-w-[300px] text-left"
          title={path}
          dir="rtl"
        >
          {field ? field : <Path>{path}</Path>}
        </div>
        <Checkbox
          disabled={loading}
          checked={enable}
          onCheckedChange={(e) => {
            if (typeof e === "boolean") {
              setLoading(true);
              onSubmit(async (path) => {
                return [
                  {
                    op: "replace",
                    path,
                    value: e ? (emptyOf(schema) as JSONValue) : null,
                  },
                ];
              })
                .then(() => {
                  setEnable(e);
                })
                .finally(() => {
                  setLoading(false);
                });
            } else {
              console.error("Expected boolean, but got", e);
            }
          }}
        />
      </div>
      {enable && (
        <ValDefaultOf
          source={emptyOf(schema)}
          schema={schema}
          path={path}
          initOnSubmit={initOnSubmit}
        />
      )}
    </div>
  );
}

function ValDefaultOf({
  source,
  path,
  schema,
  initOnSubmit,
}: {
  source: Json;
  path: SourcePath;
  schema: SerializedSchema;
  initOnSubmit: InitOnSubmit;
}): React.ReactElement {
  if (schema.type === "array") {
    if (
      typeof source === "object" &&
      (source === null || isJsonArray(source))
    ) {
      return (
        <ValList
          initOnSubmit={initOnSubmit}
          source={source === null ? [] : source}
          path={path}
          schema={schema}
        />
      );
    }
  } else if (schema.type === "object") {
    if (
      typeof source === "object" &&
      (source === null || !isJsonArray(source))
    ) {
      return (
        <ValObject
          source={source as JsonObject}
          path={path}
          schema={schema}
          initOnSubmit={initOnSubmit}
        />
      );
    }
  } else if (
    schema.type === "richtext" ||
    schema.type === "string" ||
    schema.type === "image" ||
    schema.type === "number" ||
    schema.type === "keyOf" ||
    schema.type === "boolean" ||
    schema.type === "literal" ||
    schema.type === "union"
  ) {
    return (
      <ValFormField
        key={path}
        path={path}
        source={source}
        schema={schema}
        initOnSubmit={initOnSubmit}
      />
    );
  }

  return (
    <div className="p-4 bg-destructive text-destructive-foreground">
      ERROR: unexpected source type {typeof source} for schema type{" "}
      {schema.type}
    </div>
  );
}

function dirPaths(paths: string[]): Record<string, string[]> {
  const res: Record<string, string[]> = {};
  paths.forEach((path) => {
    const allParts = path.split("/").filter((part) => part !== "");
    if (allParts.length === 1) {
      if (!res[""]) {
        res[""] = [];
      }
      res[""].push(allParts[0]);
    } else if (allParts.length > 1) {
      const dir = allParts.slice(0, allParts.length - 1).join("/");
      const file = allParts.slice(-1)[0];
      if (!res[dir]) {
        res[dir] = [];
      }
      res[dir].push(file);
    }
  });
  return res;
}

export function PathTree({
  selectedPath,
  paths,
}: {
  selectedPath: SourcePath | ModuleFilePath | undefined;
  paths: string[];
}): React.ReactElement {
  const tree = dirPaths(paths);
  const selectedModuleId =
    selectedPath &&
    Internal.splitModuleFilePathAndModulePath(selectedPath as SourcePath)[0];
  const navigate = useNavigate();
  return (
    <div className="flex flex-col w-full py-2 text-xs">
      {Object.entries(tree).map(([dir, files]) => {
        return (
          <div className="px-4 py-2" key={`/${dir}`}>
            {dir && (
              <div
                className="font-bold truncate max-w-[300px] text-left"
                title={dir}
              >
                <Path>{dir}</Path>
              </div>
            )}
            <div
              className={classNames({
                "flex flex-col py-2 justify-start items-start": !!dir,
              })}
            >
              {files.map((file) => {
                const moduleFilePath = `/${dir}/${file}` as ModuleFilePath;
                return (
                  <button
                    key={moduleFilePath}
                    className={classNames("block px-2 py-1 rounded-full", {
                      "bg-accent text-accent-foreground":
                        selectedModuleId === moduleFilePath,
                    })}
                    onClick={() => {
                      navigate(moduleFilePath);
                    }}
                  >
                    {file}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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

export function ValRichText({
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

export const ValImagePreviewContext = React.createContext<{
  hoverElem: HTMLElement | null;
}>({
  hoverElem: null,
});

export const useValImagePreviewContext = ():
  | {
      hoverElem: HTMLElement | null;
    }
  | undefined => {
  return React.useContext(ValImagePreviewContext);
};
