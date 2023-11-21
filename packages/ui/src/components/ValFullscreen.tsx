import {
  AnyRichTextOptions,
  ApiTreeResponse,
  FileSource,
  FILE_REF_PROP,
  ImageMetadata,
  Internal,
  ModuleId,
  RichText,
  RichTextNode,
  RichTextSource,
  SerializedRecordSchema,
  SerializedSchema,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/core";
import {
  SerializedArraySchema,
  SerializedObjectSchema,
  Json,
  JsonArray,
  JsonObject,
} from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import { FC, Fragment, useCallback, useEffect, useState } from "react";
import { Grid } from "./Grid";
import { result } from "@valbuild/core/fp";
import { Tree } from "./dashboard/Tree";
import { OnSubmit, ValFormField } from "./ValFormField";
import React from "react";
import { createPortal } from "react-dom";
import Logo from "../assets/icons/Logo";
import { ScrollArea } from "./ui/scroll-area";
import { Switch } from "./ui/switch";
import { Card } from "./ui/card";
import { ChevronLeft } from "lucide-react";
import { ValOverlayContext } from "./ValOverlayContext";
import { useNavigate, useParams } from "react-router";
import { useTheme } from "./useTheme";
import classNames from "classnames";
import { ValMenu } from "./ValMenu";
import { parseRichTextSource } from "@valbuild/shared/internal";

interface ValFullscreenProps {
  valApi: ValApi;
}

// TODO: move SerializedModuleContent to core
type SerializedModuleContent = ApiTreeResponse["modules"][ModuleId];
export const ValModulesContext = React.createContext<ValModules>(null);

export const useValModuleFromPath = (
  sourcePath: SourcePath
): {
  moduleId: ModuleId;
  moduleSource: Json | undefined;
  moduleSchema: SerializedSchema | undefined;
} => {
  const modules = React.useContext(ValModulesContext);
  const [moduleId, modulePath] =
    Internal.splitModuleIdAndModulePath(sourcePath);
  const moduleSource = modules?.[moduleId]?.source;
  const moduleSchema = modules?.[moduleId]?.schema;
  if (!moduleSource || !moduleSchema) {
    throw Error("Could not find module: " + moduleId);
  }
  const resolvedPath = Internal.resolvePath(
    modulePath,
    moduleSource,
    moduleSchema
  );
  return {
    moduleId,
    moduleSource: resolvedPath.source,
    moduleSchema: resolvedPath.schema,
  };
};

type ValModules = Record<ModuleId, SerializedModuleContent> | null;

type InitOnSubmit = (path: SourcePath) => OnSubmit;
export const ValFullscreen: FC<ValFullscreenProps> = ({ valApi }) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { "*": pathFromParams } = useParams();
  const [modules, setModules] = useState<ValModules>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<SourcePath | ModuleId>();
  const [selectedModuleId] = selectedPath
    ? Internal.splitModuleIdAndModulePath(selectedPath as SourcePath)
    : [undefined, undefined];
  const moduleSource = selectedModuleId && modules?.[selectedModuleId]?.source;
  const moduleSchema = selectedModuleId && modules?.[selectedModuleId]?.schema;
  const fatalErrors = Object.entries(modules || {}).flatMap(([, module]) => {
    return module.errors
      ? module.errors.fatal
        ? module.errors.fatal
        : []
      : [];
  });
  const validationErrors = Object.entries(modules || {}).flatMap(
    ([, module]) => {
      return module.errors && module.errors.validation
        ? [module.errors.validation]
        : [];
    }
  );

  if (fatalErrors && fatalErrors.length > 0) {
    const message =
      fatalErrors.length === 1
        ? fatalErrors[0].message
        : `Multiple errors detected:\n${fatalErrors
            .map((f, i) => `${i + 1}. ${f.message}`)
            .join("\n")}\n\nShowing stack trace of: 0. ${
            fatalErrors[0].message
          }`;
    const error = new Error(message);
    error.stack = fatalErrors[0].stack;
    throw error;
  }

  if (validationErrors && validationErrors.length > 0) {
    console.warn("Val encountered validation errors:", validationErrors);
  }
  //
  useEffect(() => {
    setSelectedPath(
      pathFromParams ? (`/${pathFromParams}` as ModuleId) : selectedPath
    );
  }, [pathFromParams]);

  const [hmrHash, setHmrHash] = useState(null);
  useEffect(() => {
    try {
      // use websocket to update modules
      const hot = new WebSocket(
        `${window.location.origin.replace(
          "http://",
          "ws://"
        )}/_next/webpack-hmr`
      );
      hot.addEventListener("message", (e) => {
        let data;
        try {
          data = JSON.parse(e.data);
        } catch (err) {
          console.error("Failed to parse HMR");
        }
        if (typeof data?.hash === "string" && data?.action === "built") {
          setHmrHash(data.hash);
        }
      });
    } catch (err) {
      // could not set up dev mode
      console.warn("Failed to initialize HMR", err);
    }
  }, []);
  useEffect(() => {
    console.log("(Re)-fetching modules");
    valApi
      .getModules({ patch: true, includeSchema: true, includeSource: true })
      .then((res) => {
        if (result.isOk(res)) {
          setModules(res.value.modules);
        } else {
          setError("Could not load modules: " + res.error.message);
          console.error(res.error);
        }
      });
  }, [hmrHash]);

  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    const popStateListener = (event: PopStateEvent) => {
      console.log("popstate", event);
    };

    window.addEventListener("popstate", popStateListener);

    return () => {
      window.removeEventListener("popstate", popStateListener);
    };
  }, []);

  const hoverElemRef = React.useRef<HTMLDivElement | null>(null);

  const initOnSubmit: InitOnSubmit = useCallback(
    (path) => async (callback) => {
      const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(path);
      const patch = await callback(Internal.createPatchJSONPath(modulePath));
      return valApi
        .postPatches(moduleId, patch)
        .then((res) => {
          if (result.isErr(res)) {
            throw res.error;
          } else {
            console.log("submitted", patch);
            // TODO: we need to revisit this a bit, HMR might not be the best solution here
            if (!hmrHash) {
              // TODO: we should only refresh the module that was updated
              return valApi
                .getModules({
                  patch: true,
                  includeSchema: true,
                  includeSource: true,
                })
                .then((res) => {
                  if (result.isOk(res)) {
                    setModules(res.value.modules);
                  } else {
                    setError("Could not load modules: " + res.error.message);
                    console.error(res.error);
                  }
                });
            }
          }
        })
        .catch((e) => {
          console.error(e);
        });
    },
    []
  );

  return (
    <ValOverlayContext.Provider
      value={{
        theme,
        setTheme,
        api: valApi,
        editMode: "full",
        session: { status: "not-asked" },
        highlight: false,
        setHighlight: () => {
          //
        },
        setEditMode: () => {
          //
        },
        setWindowSize: () => {
          //
        },
      }}
    >
      <div
        id="val-fullscreen-container"
        className="relative font-serif antialiased"
        data-mode={theme}
      >
        <div className="fixed -translate-x-1/2 z-overlay left-1/2 bottom-4">
          <ValMenu api={valApi} />
        </div>
        <div id="val-fullscreen-hover" ref={hoverElemRef}></div>
        <ValFullscreenHoverContext.Provider
          value={{
            hoverElem: hoverElemRef?.current,
          }}
        >
          <div className="text-primary bg-background">
            <Grid>
              <div className="px-4 h-[50px] flex items-center justify-center">
                <Logo />
              </div>
              <ScrollArea className="px-4">
                {modules ? (
                  <PathTree
                    paths={Object.keys(modules)}
                    setSelectedModuleId={(path) => {
                      navigate(path);
                    }}
                  />
                ) : (
                  !error && <div className="py-4">Loading...</div>
                )}
              </ScrollArea>
              <div className="flex items-center justify-start w-full h-[50px] gap-2 font-serif text-xs">
                <button
                  onClick={() => {
                    history.back();
                  }}
                >
                  <ChevronLeft />
                </button>
                <p>{selectedPath || "/"}</p>
              </div>
              <div className="p-4">
                {error && (
                  <div className="text-lg text-destructive-foreground">
                    ERROR: {error}
                  </div>
                )}
                {modules &&
                  selectedPath &&
                  selectedModuleId &&
                  moduleSource !== undefined &&
                  moduleSchema !== undefined && (
                    <ValModulesContext.Provider value={modules}>
                      <ValModule
                        path={selectedPath}
                        source={moduleSource}
                        schema={moduleSchema}
                        setSelectedPath={setSelectedPath}
                        initOnSubmit={initOnSubmit}
                      />
                    </ValModulesContext.Provider>
                  )}
              </div>
            </Grid>
          </div>
        </ValFullscreenHoverContext.Provider>
      </div>
    </ValOverlayContext.Provider>
  );
};

const ValFullscreenHoverContext = React.createContext<{
  hoverElem: HTMLElement | null;
}>({
  hoverElem: null,
});

const useValFullscreenHover = () => {
  return React.useContext(ValFullscreenHoverContext);
};

function ValModule({
  path,
  source: moduleSource,
  schema: moduleSchema,
  setSelectedPath,
  initOnSubmit,
}: {
  path: SourcePath | ModuleId;
  source: Json;
  schema: SerializedSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
  initOnSubmit: InitOnSubmit;
}): React.ReactElement {
  const [, modulePath] = Internal.splitModuleIdAndModulePath(
    path as SourcePath
  );
  const resolvedPath = Internal.resolvePath(
    modulePath,
    moduleSource,
    moduleSchema
  );
  if (!resolvedPath) {
    throw Error("Could not resolve module: " + path);
  }
  return (
    <AnyVal
      path={path as SourcePath}
      source={resolvedPath.source}
      schema={resolvedPath.schema as SerializedSchema}
      setSelectedPath={setSelectedPath}
      initOnSubmit={initOnSubmit}
      top
    />
  );
}

function AnyVal({
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
  if (source === null || schema.opt) {
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
  if (schema.type === "object") {
    if (typeof source !== "object" || isJsonArray(source)) {
      return <div>ERROR: expected object, but found {typeof source}</div>;
    }
    return (
      <ValObject
        source={source}
        path={path}
        schema={schema}
        initOnSubmit={initOnSubmit}
        setSelectedPath={setSelectedPath}
        top={top}
      />
    );
  } else if (schema.type === "array") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return <div>ERROR: expected array, but found {typeof source}</div>;
    }
    if (field) {
      <div>
        <div className="text-left">{field || path}</div>
        <ValList
          source={source}
          path={path}
          schema={schema}
          setSelectedPath={setSelectedPath}
        />
      </div>;
    }
    return (
      <ValList
        source={source}
        path={path}
        schema={schema}
        setSelectedPath={setSelectedPath}
      />
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
    if (field) {
      <div>
        <div className="text-left">{field || path}</div>
        <ValRecord
          source={source}
          path={path}
          schema={schema}
          setSelectedPath={setSelectedPath}
        />
      </div>;
    }
    return (
      <ValRecord
        source={source}
        path={path}
        schema={schema}
        setSelectedPath={setSelectedPath}
      />
    );
  }

  return (
    <div className="py-2 gap-y-4">
      <div className="text-left">{field || path}</div>
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
      className={classNames("flex flex-col gap-y-8", {
        "border-l-2 border-border pl-6": !top,
      })}
    >
      {Object.entries(schema.items).map(([key, property]) => {
        const subPath = createValPathOfItem(path, key);
        return (
          <AnyVal
            key={subPath}
            path={subPath}
            source={source[key]}
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
}: {
  source: JsonArray;
  path: SourcePath;
  schema: SerializedArraySchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
}): React.ReactElement {
  const navigate = useNavigate();
  return (
    <div key={path} className="flex flex-col gap-4 p-2">
      {source.map((item, index) => {
        const subPath = createValPathOfItem(path, index);
        return (
          <button
            key={subPath}
            onClick={() => {
              setSelectedPath(subPath);
              navigate(subPath);
            }}
          >
            <ValListItem
              index={index}
              key={subPath}
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

const LIST_ITEM_MAX_HEIGHT = RECORD_ITEM_MAX_HEIGHT;
function ValListItem({
  index,
  path,
  source,
  schema,
}: {
  index: number;
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
}): React.ReactElement {
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
      <div className="pb-4 font-serif text-left uppercase text-accent">
        {index + 1 < 10 ? `0${index + 1}` : index + 1}
      </div>
      <div className="text-xs">
        <ValPreview path={path} source={source} schema={schema} />
      </div>
      {isTruncated && (
        <div className="absolute bottom-0 left-0 w-full h-[20px] bg-gradient-to-b from-transparent to-background"></div>
      )}
    </Card>
  );
}

function createValPathOfItem(
  arrayPath: SourcePath | undefined,
  prop: string | number | symbol
) {
  const val = Internal.createValPathOfItem(arrayPath, prop);
  if (!val) {
    // Should never happen
    throw Error(
      `Could not create val path: ${arrayPath} of ${prop?.toString()}`
    );
  }
  return val;
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
  const { hoverElem } = useValFullscreenHover();

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

  return (
    <div className="flex flex-col gap-y-6" key={path}>
      {field ? (
        <div className="flex items-center justify-start gap-x-4">
          <Switch
            checked={enable}
            onClick={() => {
              setEnable((prev) => !prev);
            }}
          />
          <span>{field}</span>
        </div>
      ) : (
        <Switch
          checked={enable}
          onClick={() => {
            setEnable((prev) => !prev);
          }}
        />
      )}
      {enable && (
        <ValDefaultOf
          source={source}
          schema={schema}
          path={path}
          setSelectedPath={setSelectedPath}
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
    schema.type === "keyOf"
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

type Tree = {
  [key: string]: Tree;
};
function pathsToTree(paths: string[]): Tree {
  const tree: Tree = {};
  paths.forEach((path) => {
    const parts = path.split("/").filter((part) => part !== "");
    let current = tree;
    parts.forEach((part) => {
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part] as Tree;
    });
  });
  return tree;
}

function PathTree({
  paths,
  setSelectedModuleId,
}: {
  paths: string[];
  setSelectedModuleId: (path: ModuleId | SourcePath) => void;
}): React.ReactElement {
  const tree = pathsToTree(paths);
  return (
    <Tree>
      {Object.entries(tree).map(([name, subTree]) => (
        <div className="px-4 py-2" key={`/${name}`}>
          <PathNode
            name={name}
            tree={subTree}
            moduleId={`/${name}` as ModuleId}
            setSelectedModuleId={setSelectedModuleId}
          />
        </div>
      ))}
    </Tree>
  );
}

function PathNode({
  name,
  tree,
  moduleId,
  setSelectedModuleId,
}: {
  name: string;
  tree: Tree;
  moduleId: ModuleId;
  setSelectedModuleId: (moduleId: ModuleId | SourcePath) => void;
}): React.ReactElement {
  return (
    <div>
      <button
        onClick={() => {
          setSelectedModuleId(moduleId);
        }}
      >
        {name}
      </button>
      {Object.entries(tree).map(([childName, childTree]) => (
        <div className="px-4 py-1" key={`${moduleId}/${childName}` as ModuleId}>
          <PathNode
            name={childName}
            tree={childTree}
            moduleId={`${moduleId}/${childName}` as ModuleId}
            setSelectedModuleId={setSelectedModuleId}
          />
        </div>
      ))}
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
