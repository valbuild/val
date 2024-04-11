import {
  SourcePath,
  Json,
  SerializedSchema,
  ModuleId,
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
  ImageSource,
} from "@valbuild/core";
import { parseRichTextSource } from "@valbuild/shared/internal";
import classNames from "classnames";
import React, { useState, useEffect, Fragment } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import {
  ValFormField,
  FieldContainer,
  SubmitButton,
  InitOnSubmit,
} from "./ValFormField";
import { useValUIContext } from "./ValUIContext";
import { Card } from "./ui/card";
import { Path } from "./Path";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import { JSONValue, Patch } from "@valbuild/core/patch";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Plus, RotateCw, Trash } from "lucide-react";
import { Button } from "./ui/button";
import { array } from "@valbuild/core/fp";

export function AnyVal({
  path,
  source,
  schema,
  setSelectedPath,
  field,
  initOnSubmit,
  top,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
  field?: string;
  initOnSubmit: InitOnSubmit;
  top?: boolean;
}): React.ReactElement {
  if (schema.opt) {
    return (
      <ValOptional
        path={path}
        source={source}
        schema={schema}
        field={field}
        initOnSubmit={initOnSubmit}
        setSelectedPath={setSelectedPath}
      />
    );
  }
  if (source === null) {
    return (
      <ValDefaultOf
        source={source}
        schema={schema}
        path={path}
        setSelectedPath={setSelectedPath}
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
          setSelectedPath={setSelectedPath}
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
          setSelectedPath={setSelectedPath}
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
        <ValRecord
          source={source}
          path={path}
          schema={schema}
          setSelectedPath={setSelectedPath}
        />
      </div>
    );
  } else if (schema?.type === "union") {
    if (
      typeof schema.key === "string" &&
      typeof source === "object" &&
      !isJsonArray(source)
    ) {
      return (
        <ValTagged
          field={field}
          tag={schema.key}
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
          setSelectedPath={setSelectedPath}
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
        disabled={false}
        source={source}
        schema={schema}
        onSubmit={initOnSubmit(path)}
      />
    </div>
  );
}

function ValTagged({
  tag,
  field,
  path,
  source,
  schema,
  setSelectedPath,
  initOnSubmit,
  top,
}: {
  tag: string;
  field?: string;
  source: JsonObject;
  path: SourcePath;
  schema: {
    type: "union";
    key: string;
    items: SerializedSchema[];
    opt: boolean;
  };
  setSelectedPath: (path: SourcePath | ModuleId) => void;
  initOnSubmit: InitOnSubmit;
  top?: boolean;
}) {
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [current, setCurrent] = useState<{
    schema: SerializedSchema;
    source?: Json;
  } | null>(null);

  const keys = schema.items.flatMap((item) => {
    if (item.type === "object" && item.items[tag]) {
      const maybeLiteral = item.items[tag];
      if (maybeLiteral.type === "literal") {
        return [maybeLiteral.value];
      }
    }
    return [];
  });
  useEffect(() => {
    if (!currentKey) {
      const maybeCurrentKey = source?.[tag];
      if (maybeCurrentKey && typeof maybeCurrentKey === "string") {
        setCurrentKey(maybeCurrentKey);
      }
    } else {
      const sourceKey = source[tag];
      const unionSchema = schema.items.find((item) => {
        if (item.type === "object" && item.items[tag]) {
          const maybeLiteral = item.items[tag];
          if (maybeLiteral.type === "literal") {
            return maybeLiteral.value === currentKey;
          }
          return false;
        }
      });
      if (sourceKey && typeof sourceKey === "string" && unionSchema) {
        setCurrent({ source, schema: unionSchema });
      } else if (unionSchema) {
        setCurrent({ schema: unionSchema });
      } else {
        console.error(
          "Could not find source or schema of key",
          currentKey,
          source,
          schema
        );
        setCurrent(null);
      }
    }
  }, [currentKey, source, tag, schema, keys]);
  if (keys.length !== schema.items.length) {
    console.warn("Not all items have tag:", tag);
  }
  const loading = false;
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
        }}
      >
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
      </Select>
      <SubmitButton
        loading={loading}
        enabled={false}
        onClick={() => onSubmit(async () => [])}
      />
      {current && (
        <AnyVal
          path={path as SourcePath}
          source={current.source ?? null}
          schema={current.schema}
          setSelectedPath={setSelectedPath}
          initOnSubmit={initOnSubmit}
          top={top}
        />
      )}
    </FieldContainer>
  );
}

function ValObject({
  path,
  source,
  schema,
  setSelectedPath,
  initOnSubmit,
  top,
}: {
  source: JsonObject;
  path: SourcePath;
  schema: SerializedObjectSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
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
            setSelectedPath={setSelectedPath}
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
  setSelectedPath,
}: {
  source: JsonObject;
  path: SourcePath;
  schema: SerializedRecordSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
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
              setSelectedPath(subPath);
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
  setSelectedPath,
  initOnSubmit,
}: {
  source: JsonArray;
  path: SourcePath;
  schema: SerializedArraySchema;
  initOnSubmit: InitOnSubmit;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
}): React.ReactElement {
  const onSubmit = initOnSubmit(path);
  const [, modulePath] = Internal.splitModuleIdAndModulePath(path);

  return (
    <FieldContainer key={path} className="flex flex-col gap-4 p-2 pb-8">
      <button
        onClick={() => {
          onSubmit(async () => {
            const patch: Patch = [];
            if (source === null) {
              patch.push({
                op: "replace",
                path: Internal.createPatchPath(modulePath),
                value: [],
              });
            }
            patch.push({
              op: "add",
              path: Internal.createPatchPath(
                createValPathOfItem(modulePath, source.length)
              ),
              value: emptyOf(schema.item) as JSONValue,
            });
            return patch;
          });
        }}
      >
        <Plus />
      </button>
      {source.map((item, index) => {
        const subPath = createValPathOfItem(path, index);
        const onSubmit = initOnSubmit(subPath);

        return (
          <ValListItem
            index={index}
            key={subPath}
            path={subPath}
            source={item}
            loading={false}
            schema={schema.item}
            onDelete={() => {
              onSubmit(async (path) => {
                if (path.length > 0) {
                  return [
                    {
                      op: "remove",
                      path: path as array.NonEmptyArray<string>,
                    },
                  ];
                }
                console.error("Cannot delete a root element");
                return [];
              });
            }}
            setSelectedPath={setSelectedPath}
          />
        );
      })}
    </FieldContainer>
  );
}

const LIST_ITEM_MAX_HEIGHT = RECORD_ITEM_MAX_HEIGHT;
function ValListItem({
  index,
  path,
  source,
  schema,
  loading,
  setSelectedPath,
  onDelete,
}: {
  index: number;
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
  loading: boolean;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
  onDelete: () => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const ref = React.useRef<HTMLDivElement>(null);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
  useEffect(() => {
    if (ref.current) {
      const height = ref.current.getBoundingClientRect().height;
      if (height >= LIST_ITEM_MAX_HEIGHT) {
        setIsTruncated(true);
      }
    }
  }, []);
  return (
    <Card
      ref={ref}
      className="relative px-4 pt-2 pb-4 overflow-hidden border gap-y-2"
      style={{
        maxHeight: LIST_ITEM_MAX_HEIGHT,
      }}
    >
      <button className="block" disabled={loading} onClick={onDelete}>
        {loading ? <RotateCw className="animate-spin" /> : <Trash />}
      </button>
      <button
        className="block"
        disabled={loading}
        onClick={() => {
          setSelectedPath(path);
          navigate(path);
        }}
      >
        <div className="pb-4 font-serif text-left uppercase text-accent">
          {index + 1 < 10 ? `0${index + 1}` : index + 1}
        </div>
        <div className="text-xs">
          <ValPreview path={path} source={source} schema={schema} />
        </div>
        {isTruncated && (
          <div className="absolute bottom-0 left-0 w-full h-[20px] bg-gradient-to-b from-transparent to-background"></div>
        )}
      </button>
    </Card>
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

function ValOptional({
  path,
  source,
  schema,
  setSelectedPath,
  initOnSubmit,
  field,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
  initOnSubmit: InitOnSubmit;
  field?: string;
}) {
  const [enable, setEnable] = useState<boolean>(source !== null);
  const { editMode } = useValUIContext();
  const onSubmit = initOnSubmit(path);
  const [loading, setLoading] = useState<boolean>(false);

  return (
    <div className="flex flex-col gap-y-2" key={path}>
      <div className="relative flex items-center justify-start gap-x-4">
        {editMode === "full" && !enable && (
          <Switch
            disabled={loading}
            checked={enable}
            onClick={() => {
              setEnable((prev) => !prev);
            }}
          />
        )}
        {editMode === "full" && enable && (
          <Dialog>
            <DialogTrigger>
              <Trash />
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>About to delete. Are you sure?</DialogTitle>
                <DialogFooter className="sm:justify-start">
                  <DialogClose asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={async () => {
                        setLoading(true);
                        setEnable(false);
                        const [, modulePath] =
                          Internal.splitModuleIdAndModulePath(path);
                        onSubmit(async () => {
                          return [
                            {
                              op: "replace",
                              path: Internal.createPatchPath(modulePath),
                              value: null,
                            },
                          ] as Patch;
                        })
                          .catch((err) => {
                            console.error(err);
                            setEnable(true);
                          })
                          .finally(() => {
                            setLoading(false);
                          });
                      }}
                    >
                      Yes
                    </Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button type="button">Cancel</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        )}
        <div
          className="truncate max-w-[300px] text-left"
          title={path}
          dir="rtl"
        >
          {field ? field : <Path>{path}</Path>}
        </div>
      </div>
      {enable && (
        <ValDefaultOf
          source={source === null ? emptyOf(schema) : source}
          schema={schema}
          path={path}
          setSelectedPath={setSelectedPath}
          initOnSubmit={(subPath) => async (callback) => {
            const [, modulePath] = Internal.splitModuleIdAndModulePath(path);
            const [, subModulePath] =
              Internal.splitModuleIdAndModulePath(subPath);
            const patch = await callback(
              Internal.createPatchPath(subModulePath)
            );
            onSubmit(async () => {
              if (source === null) {
                return (
                  [
                    {
                      op: "replace",
                      path: Internal.createPatchPath(modulePath),
                      value: emptyOf(schema),
                    },
                  ] as Patch
                ).concat(patch);
              }
              return patch;
            });
          }}
        />
      )}
    </div>
  );
}

function emptyOf(schema: SerializedSchema): Json {
  if (schema.type === "object") {
    return Object.fromEntries(
      Object.keys(schema.items).map((key) => [key, emptyOf(schema.items[key])])
    );
  } else if (schema.type === "array") {
    return [];
  } else if (schema.type === "record") {
    return {};
  } else if (schema.opt) {
    return null;
  } else if (schema.type === "richtext") {
    return {
      [VAL_EXTENSION]: "richtext",
      templateStrings: [""],
      exprs: [],
    } satisfies RichTextSource<AnyRichTextOptions>;
  } else if (schema.type === "string") {
    return "";
  } else if (schema.type === "boolean") {
    return false;
  } else if (schema.type === "number") {
    return 0;
  } else if (schema.type === "keyOf") {
    if (schema.values === "number") {
      return 0; // TODO: figure out this: user code might very well fail in this case
    } else if (schema.values === "string") {
      return ""; // TODO: figure out this: user code might very well fail in this case
    } else {
      return schema.values[0];
    }
  } else if (schema.type === "file") {
    return {
      _ref: "/public/",
      _type: "file",
      metadata: {
        sha256: "",
      },
    } satisfies FileSource;
  } else if (schema.type === "image") {
    return {
      _ref: "/public/",
      _type: "file",
      metadata: {
        height: 0,
        width: 0,
        mimeType: "application/octet-stream",
        sha256: "",
      },
    } satisfies ImageSource;
  } else if (schema.type === "literal") {
    return schema.value;
  } else if (schema.type === "union") {
    return emptyOf(schema.items[0]);
  }
  const _exhaustiveCheck: never = schema;
  throw Error("Unexpected schema type: " + JSON.stringify(_exhaustiveCheck));
}

function ValDefaultOf({
  source,
  path,
  schema,
  setSelectedPath,
  initOnSubmit,
}: {
  source: Json;
  path: SourcePath;
  schema: SerializedSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
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
          setSelectedPath={setSelectedPath}
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
          setSelectedPath={setSelectedPath}
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
        disabled={false}
        source={source}
        schema={schema}
        onSubmit={initOnSubmit(path)}
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

function isJsonArray(source: JsonArray | JsonObject): source is JsonArray {
  return Array.isArray(source);
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
  setSelectedModuleId,
}: {
  selectedPath: SourcePath | ModuleId | undefined;
  paths: string[];
  setSelectedModuleId: (path: ModuleId | SourcePath) => void;
}): React.ReactElement {
  const tree = dirPaths(paths);
  const selectedModuleId =
    selectedPath &&
    Internal.splitModuleIdAndModulePath(selectedPath as SourcePath)[0];
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
                const moduleId = `/${dir}/${file}` as ModuleId;
                return (
                  <button
                    key={moduleId}
                    className={classNames("block px-2 py-1 rounded-full", {
                      "bg-accent text-accent-foreground":
                        selectedModuleId === moduleId,
                    })}
                    onClick={() => {
                      setSelectedModuleId(moduleId);
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
