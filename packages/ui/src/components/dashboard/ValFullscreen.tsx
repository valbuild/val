"use client";
import {
  AnyRichTextOptions,
  Internal,
  ModuleId,
  RichText,
  RichTextNode,
  RichTextOptions,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import {
  SerializedArraySchema,
  SerializedObjectSchema,
  Json,
  JsonArray,
  JsonObject,
} from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import { FC, useEffect, useState } from "react";
import { Grid } from "./Grid";
import { result } from "@valbuild/core/fp";
import { Tree } from "./Tree";
import { ValFormField } from "../ValFormField";
import { ChevronLeft, Folder, Image as ImageIcon, List } from "react-feather";
import React from "react";
import { parseRichTextSource } from "../../exports";
import { createPortal } from "react-dom";
import Logo from "../../assets/icons/Logo";

interface ValFullscreenProps {
  valApi: ValApi;
}
export const ValFullscreen: FC<ValFullscreenProps> = ({ valApi }) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [modules, setModules] = useState<Record<
    ModuleId,
    {
      schema?: SerializedSchema | undefined;
      patches?:
        | {
            applied: string[];
            failed?: string[] | undefined;
          }
        | undefined;
      source?: Json | undefined;
    }
  > | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<SourcePath | ModuleId>();
  const [selectedModuleId] = selectedPath
    ? Internal.splitModuleIdAndModulePath(selectedPath as SourcePath)
    : [undefined, undefined];
  const moduleSource = selectedModuleId && modules?.[selectedModuleId]?.source;
  const moduleSchema = selectedModuleId && modules?.[selectedModuleId]?.schema;

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const hoverElemRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const popStateListener = (ev: PopStateEvent) => {
      console.log(JSON.stringify(ev.state));
      if (ev.state?.path) {
        setSelectedPath(ev.state.path);
      }
    };
    window.addEventListener("popstate", popStateListener);
    return () => {
      window.removeEventListener("popstate", popStateListener);
    };
  }, []);

  return (
    <div className="relative">
      <div id="val-fullscreen-hover" ref={hoverElemRef}></div>
      <ValFullscreenHoverContext.Provider
        value={{
          hoverElem: hoverElemRef?.current,
        }}
      >
        <div className="text-primary">
          <Grid>
            <div className="px-4">
              <Logo />
            </div>
            {modules ? (
              <PathTree
                paths={Object.keys(modules)}
                setSelectedModuleId={setSelectedPath}
              />
            ) : (
              !error && <div>Loading...</div>
            )}

            <div className="flex items-center justify-start w-full h-[50px] gap-2 font-serif text-xs text-white">
              <button
                onClick={() => {
                  history.back();
                }}
              >
                <ChevronLeft />
              </button>
              <p>{selectedPath || "/"}</p>
            </div>
            <div className="px-4">
              {error && <div className="text-lg text-red">ERROR: {error}</div>}
              {!modules && !error && <div>Loading...</div>}
              {modules &&
                selectedPath &&
                selectedModuleId &&
                moduleSource !== undefined &&
                moduleSchema !== undefined && (
                  <ValModule
                    path={selectedPath}
                    source={moduleSource}
                    schema={moduleSchema}
                    setSelectedPath={setSelectedPath}
                  />
                )}
            </div>
          </Grid>
        </div>
      </ValFullscreenHoverContext.Provider>
    </div>
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
}: {
  path: SourcePath | ModuleId;
  source: Json;
  schema: SerializedSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
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
    />
  );
}

function AnyVal({
  path,
  source,
  schema,
  setSelectedPath,
  field,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
  field?: string;
}): React.ReactElement {
  if (source === null || schema.opt) {
    return (
      <ValOptional
        path={path}
        source={source}
        schema={schema}
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
        setSelectedPath={setSelectedPath}
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
  }

  return (
    <div>
      <div className="text-left">{field || path}</div>
      <ValFormField
        path={path}
        disabled={false}
        source={source}
        schema={schema}
        registerPatchCallback={() => {
          // TODO
        }}
      />
    </div>
  );
}

function ValObject({
  path,
  source,
  schema,
  setSelectedPath,
}: {
  source: JsonObject | null;
  path: SourcePath;
  schema: SerializedObjectSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
}): React.ReactElement {
  if (source === null) {
    return (
      <div key={path}>
        <div className="flex items-center justify-center gap-2">
          <span>{path}</span> <Folder size={16} />
        </div>
        <div>TODO: empty object</div>
      </div>
    );
  }
  return (
    <div key={path}>
      {Object.entries(schema.items).map(([key, property]) => {
        const subPath = Internal.createValPathOfItem(path, key);
        if (!subPath) {
          throw Error(
            "Could not create path for key " + key + " of path " + path
          );
        }
        return (
          <div key={subPath} className="grid">
            <div>{key}</div>
            <AnyVal
              key={subPath}
              path={subPath}
              source={source[key]}
              schema={property}
              setSelectedPath={setSelectedPath}
            />
          </div>
        );
      })}
    </div>
  );
}

function ValList({
  path,
  source,
  schema,
  setSelectedPath,
}: {
  source: JsonArray | null;
  path: SourcePath;
  schema: SerializedArraySchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
}): React.ReactElement {
  if (source === null) {
    return (
      <div key={path}>
        <div className="flex items-center justify-center gap-2">
          <span>{path}</span> <List size={16} />
        </div>
        <div>TODO: empty array</div>
      </div>
    );
  }
  return (
    <div key={path} className="flex flex-wrap gap-4 p-2">
      {source.map((item, index) => {
        const subPath = Internal.createValPathOfItem(path, index);
        if (!subPath) {
          throw Error(
            "Could not create path for index " + index + " of path " + path
          );
        }
        return (
          <button
            key={path}
            onClick={() => {
              window.history.pushState({ path: subPath }, "");
              setSelectedPath(subPath);
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
  return (
    <div className="relative px-4 border rounded h-[5em] max-w-[15em] overflow-hidden pb-4 pt-2">
      <div className="absolute top-0 left-0 p-2 text-base uppercase bg-primary">
        {index + 1}
      </div>
      <div className="pl-4 text-xs">
        <ValPreview path={path} source={source} schema={schema} />
      </div>
      <div
        className="absolute bottom-0 left-0 w-full h-[1em]"
        style={{
          backgroundImage:
            "linear-gradient(to bottom, rgba(26, 26, 26, 0) 7.52%, rgb(26, 26, 26, 0.8) 83.52%)",
        }}
      ></div>
    </div>
  );
}

function ValPreview({
  path,
  source,
  schema,
}: {
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
}) {
  const [isMouseOver, setIsMouseOver] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const { hoverElem } = useValFullscreenHover();

  if (schema.type === "object") {
    return (
      <div className="flex flex-col gap-1 text-left">
        {Object.entries(schema.items).map(([key]) => {
          if (schema.items[key].type === "image")
            return (
              <div className="flex items-center gap-1">
                <span>{key}:</span>
                <span>
                  <ValPreview
                    source={source[key]}
                    schema={schema.items[key]}
                    path={Internal.createValPathOfItem(path, key)}
                  />
                </span>
              </div>
            );
          return (
            <div className="flex gap-1">
              <span>{key}:</span>
              <span>
                <ValPreview
                  source={source[key]}
                  schema={schema.items[key]}
                  path={Internal.createValPathOfItem(path, key)}
                />
              </span>
            </div>
          );
        })}
      </div>
    );
  } else if (schema.type === "array") {
    return null;
  } else if (schema.type === "richtext") {
    return (
      <ValRichText
        theme={{
          tags: {
            p: "inline",
          },
          classes: {},
        }}
      >
        {parseRichTextSource(source)}
      </ValRichText>
    );
  } else if (schema.type === "string") {
    return <span>{source}</span>;
  } else if (schema.type === "image") {
    const url = Internal.convertFileSource(source).url;
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
        className="flex items-center justify-start gap-1"
      >
        <a href={url} className="relative underline">
          <img className="w-[1em]" src={url}></img>
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
        </a>
      </span>
    );
  }

  return <div>TODO: {schema.type}</div>;
}

function ValOptional({
  path,
  source,
  schema,
  setSelectedPath,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
}) {
  const [enable, setEnable] = useState<boolean>(source !== null);

  return (
    <div>
      <div>
        <input
          type="checkbox"
          checked={enable}
          onClick={() => {
            setEnable((prev) => !prev);
          }}
        />
        <span>ENABLE</span>
      </div>
      {enable && (
        <ValDefaultOf
          source={source}
          schema={schema}
          path={path}
          setSelectedPath={setSelectedPath}
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
}: {
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
  setSelectedPath: (path: SourcePath | ModuleId) => void;
}): React.ReactElement {
  if (schema.type === "array") {
    return (
      <ValList
        source={
          source as JsonArray | null // TODO
        }
        path={path}
        schema={schema}
        setSelectedPath={setSelectedPath}
      />
    );
  } else if (schema.type === "object") {
    return (
      <ValObject
        source={
          source as JsonObject | null // TODO
        }
        path={path}
        schema={schema}
        setSelectedPath={setSelectedPath}
      />
    );
  }
  return (
    <ValFormField
      path={path}
      disabled={false}
      source={source}
      schema={schema}
      registerPatchCallback={() => {}}
    />
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
  console.log(tree);
  return (
    <Tree>
      {Object.entries(tree).map(([name, subTree]) => (
        <div className="px-4">
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
        <div className="px-4">
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
    key: number | string,
    first?: boolean | undefined
  ): React.ReactNode {
    if (typeof node === "string") {
      return node;
    }
    if (node.tag === "p") {
      if (first) {
        return <>{node.children.map((child, key) => toReact(child, key))}</>;
      }
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
        if (i === 0) {
          return toReact(child, i, true);
        }
        return toReact(child, i);
      })}
    </span>
  );
}
