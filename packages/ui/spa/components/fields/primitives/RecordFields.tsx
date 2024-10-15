import {
  JsonObject,
  SourcePath,
  SerializedRecordSchema,
  Json,
  SerializedSchema,
  AllRichTextOptions,
  FILE_REF_PROP,
  Internal,
  ModulePath,
  RichTextNode,
  RichTextSource,
  VAL_EXTENSION,
} from "@valbuild/core";
import { array } from "@valbuild/core/fp";
import { JSONValue } from "@valbuild/core/patch";
import { Check, Plus, X } from "lucide-react";
import React, { useState, useEffect, Fragment } from "react";
import { emptyOf } from "../emptyOf";
import { useBounceSubmit, SubmitStatus } from "../SubmitStatus";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Input } from "../../ui/input";
import { InitOnSubmit } from "../ValFormField";
import { FieldContainer } from "../FieldContainer";
import { ValImagePreview } from "../PreviewImage";
import { useNavigation } from "../../ValRouter";

export function ValRecord({
  path,
  source,
  schema,
  initOnSubmit,
}: {
  source: JsonObject;
  path: SourcePath;
  schema: SerializedRecordSchema;
  initOnSubmit: InitOnSubmit;
}): React.ReactElement {
  const onSubmit = initOnSubmit(path);
  const [newKey, setNewKey] = useState<false | { key: string }>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const allKeys = Object.keys(source);
  return (
    <FieldContainer className="flex flex-col">
      {newKey ? (
        <form
          className="flex gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (!newKey.key || allKeys.includes(newKey.key)) {
              return;
            }
            setLoading(true);
            onSubmit(async (path) => {
              return [
                {
                  op: "add",
                  path: path.concat(newKey.key) as array.NonEmptyArray<string>,
                  value: emptyOf(schema.item) as JSONValue,
                },
              ];
            })
              .then(() => {
                setNewKey(false);
              })
              .finally(() => {
                setLoading(false);
              });
          }}
          title={allKeys.includes(newKey.key) ? "Key already exists" : ""}
        >
          <Input
            value={newKey.key}
            onChange={(e) => setNewKey({ key: e.target.value })}
          />
          <Button disabled={loading || allKeys.includes(newKey.key)}>
            <Check />
          </Button>
        </form>
      ) : (
        <button
          className="self-end p-2"
          disabled={loading}
          onClick={() => {
            setNewKey({ key: "" });
          }}
        >
          <Plus />
        </button>
      )}
      <div key={path} className="flex flex-col gap-4 p-2">
        {Object.entries(source)
          .sort(([key1], [key2]) => key1.localeCompare(key2))
          .map(([key, item]) => {
            const subPath = createValPathOfItem(path, key);
            if (!subPath) {
              console.error("Could not create record subPath", path, key);
              return null;
            }
            const onSubmit = initOnSubmit(subPath);
            return (
              <div
                className="grid grid-cols-[auto,min-content] items-start gap-2"
                key={key}
              >
                <ValRecordItem
                  allKeys={allKeys}
                  recordKey={key}
                  path={subPath}
                  source={item}
                  schema={schema.item}
                  initOnSubmit={initOnSubmit}
                />
                <button
                  onClick={() => {
                    setLoading(true);
                    onSubmit(async (path) => {
                      return [
                        {
                          op: "remove",
                          path: path as array.NonEmptyArray<string>,
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
                >
                  <X />
                </button>
              </div>
            );
          })}
      </div>
    </FieldContainer>
  );
}

const RECORD_ITEM_MAX_HEIGHT = 170;
function ValRecordItem({
  recordKey,
  allKeys,
  path,
  source,
  schema,
  initOnSubmit,
}: {
  recordKey: string;
  allKeys: string[];
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
  initOnSubmit: InitOnSubmit;
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
  const navigate = useNavigation();
  const onSubmit = initOnSubmit(path);
  const [currentKey, setCurrentKey] = useState<string>(recordKey);
  useEffect(() => {
    setCurrentKey(recordKey);
  }, [recordKey]);
  const existingKey = allKeys.includes(currentKey);
  const submitStatus = useBounceSubmit(
    !existingKey,
    currentKey,
    onSubmit,
    async (value, path) => {
      return [
        {
          op: "move",
          from: path as array.NonEmptyArray<string>,
          path: path.slice(0, -1).concat(value),
        },
      ];
    },
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <Card
      ref={ref}
      className="relative px-4 pt-2 pb-4 overflow-hidden border gap-y-2"
      style={{
        maxHeight: RECORD_ITEM_MAX_HEIGHT,
      }}
    >
      <div className="relative flex gap-2 pr-6">
        <Input
          disabled={submitStatus === "loading"}
          className="font-serif text-left text-accent"
          value={currentKey}
          onChange={(e) => {
            const nextKey = e.target.value;
            if (nextKey !== recordKey) {
              if (!allKeys.includes(nextKey)) {
                setCurrentKey(e.target.value);
              } else {
                setError("Key already exists");
              }
            }
          }}
        />
        <div className="absolute top-2 -right-4">
          {error ? (
            <div className="text-destructive" title={error}>
              <X />
            </div>
          ) : (
            <SubmitStatus submitStatus={submitStatus} />
          )}
        </div>
      </div>
      <button
        className="text-xs"
        key={path}
        onClick={() => {
          navigate(path);
        }}
      >
        <ValPreview path={path} source={source} schema={schema} />
      </button>
      {isTruncated && (
        <div className="absolute bottom-0 left-0 w-full h-[20px] bg-gradient-to-b from-transparent to-background"></div>
      )}
    </Card>
  );
}

function createValPathOfItem<S extends SourcePath | ModulePath>(
  arrayPath: S | undefined,
  prop: string | number | symbol,
): S {
  const val = Internal.createValPathOfItem(arrayPath, prop);
  if (!val) {
    // Should never happen
    throw Error(
      `Could not create val path: ${arrayPath} of ${prop?.toString()}`,
    );
  }
  return val as S;
}

// TODO: we have 2 different previews: one for records and one for arrays. The arrays preview is newer. We should use only the arrays one and remove this:
function ValPreview({
  path,
  source,
  schema,
}: {
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
}): React.ReactElement {
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
    if (!Array.isArray(source)) {
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
      <ValRichTextPreview key={path}>{{ children: source }}</ValRichTextPreview>
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
    return <ValImagePreview key={path} source={source} />;
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
  } else if (schema.type === "date") {
    return <span>{source?.toString()}</span>;
  }

  console.error("Unexpected schema type", schema);
  return <div key={path}>Missing preview of: {schema.type}</div>;
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

export function ValRichTextPreview({
  children: root,
}: {
  children: {
    children: RichTextSource<AllRichTextOptions>;
  };
}) {
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
    node: RichTextNode<AllRichTextOptions>,
    key: number | string,
  ): React.ReactNode {
    if (typeof node === "string") {
      return node;
    }
    if (VAL_EXTENSION in node) {
      // TODO:
      return <img></img>;
    }
    if (node.tag === "p") {
      return (
        <p className={withRenderTag("p")} key={key}>
          {node.children.map((child, key) => toReact(child, key))}
        </p>
      );
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
          className={node.styles
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
    if (node.tag === "img") {
      return <ValImagePreview source={node.src} />;
    }

    const _exhaustiveCheck: never = node;
    console.error(
      "Unexpected RichText node: " + JSON.stringify(_exhaustiveCheck),
    );
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
    <span>
      {root.children.map((child, i) => {
        return toReact(child, i);
      })}
    </span>
  );
}
