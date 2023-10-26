"use client";
import {
  Internal,
  ModuleId,
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
import { FormGroup } from "./FormGroup";
import { Folder, List } from "react-feather";

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
  const [selectedModuleId, selectedModulePath] = selectedPath
    ? Internal.splitModuleIdAndModulePath(selectedPath as SourcePath)
    : [undefined, undefined];
  const selectedSource =
    selectedModuleId && modules?.[selectedModuleId]?.source;
  const selectedSchema =
    selectedModuleId && modules?.[selectedModuleId]?.schema;

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
  return (
    <div className="text-primary">
      <Grid>
        <div className="px-4">VAL</div>
        {modules ? (
          <PathTree
            paths={Object.keys(modules)}
            setSelectedModuleId={setSelectedPath}
          />
        ) : (
          !error && <div>Loading...</div>
        )}

        <div className="flex items-center justify-between w-full h-full px-3 font-serif text-xs text-white">
          <p>Content</p>
          <button className="flex justify-between flex-shrink-0 gap-1">
            <span className="w-fit">+</span>
            <span className="w-fit">Add item</span>
          </button>
        </div>
        <div className="px-4">
          {error && <div className="text-lg text-red">ERROR: {error}</div>}
          {!modules && !error && <div>Loading...</div>}
          {modules && selectedModuleId && selectedSource && selectedSchema && (
            <ValModule
              path={selectedModuleId as unknown as SourcePath}
              source={selectedSource}
              schema={selectedSchema}
            />
          )}
        </div>
      </Grid>
    </div>
  );
};

function ValModule({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
}): React.ReactElement {
  if (source === null || schema.opt) {
    return <ValOptional path={path} source={source} schema={schema} />;
  }
  if (schema.type === "object") {
    if (typeof source !== "object" || isJsonArray(source)) {
      return <div>ERROR: expected object, but found {typeof source}</div>;
    }
    return <ValObject source={source} path={path} schema={schema} />;
  } else if (schema.type === "array") {
    if (typeof source !== "object" || !isJsonArray(source)) {
      return <div>ERROR: expected array, but found {typeof source}</div>;
    }
    return <ValArray source={source} path={path} schema={schema} />;
  }

  return (
    <FormGroup key={path}>
      <div>{path}</div>
      <ValFormField
        path={path}
        disabled={false}
        source={source}
        schema={schema}
        registerPatchCallback={() => {
          // TODO
        }}
      />
    </FormGroup>
  );
}

function ValObject({
  path,
  source,
  schema,
}: {
  source: JsonObject | null;
  path: SourcePath;
  schema: SerializedObjectSchema;
}): React.ReactElement {
  if (source === null) {
    return (
      <FormGroup key={path}>
        <div className="flex items-center justify-center gap-2">
          <span>{path}</span> <Folder size={16} />
        </div>
        <div>TODO: empty object</div>
      </FormGroup>
    );
  }
  return (
    <FormGroup key={path} defaultExpanded={true}>
      <div className="flex items-center justify-center gap-2">
        <span>{path}</span>
        <Folder size={16} />
      </div>
      {Object.entries(schema.items).map(([key, property]) => {
        const subPath = Internal.createValPathOfItem(path, key);
        if (!subPath) {
          throw Error(
            "Could not create path for key " + key + " of path " + path
          );
        }
        return (
          <div key={path}>
            <div>{key}</div>
            <ValModule source={source[key]} schema={property} path={subPath} />
          </div>
        );
      })}
    </FormGroup>
  );
}

function ValArray({
  path,
  source,
  schema,
}: {
  source: JsonArray | null;
  path: SourcePath;
  schema: SerializedArraySchema;
}): React.ReactElement {
  if (source === null) {
    return (
      <FormGroup key={path}>
        <div className="flex items-center justify-center gap-2">
          <span>{path}</span> <List size={16} />
        </div>
        <div>TODO: empty array</div>
      </FormGroup>
    );
  }
  return (
    <FormGroup key={path} className="px-2" defaultExpanded={false}>
      <div className="flex items-center justify-center gap-2">
        <span>{path}</span>
        <List size={16} />
      </div>
      {source.map((item, index) => {
        const subPath = Internal.createValPathOfItem(path, index);
        if (!subPath) {
          throw Error(
            "Could not create path for index " + index + " of path " + path
          );
        }
        return (
          <div key={path}>
            <ValModule source={item} schema={schema.item} path={subPath} />
          </div>
        );
      })}
    </FormGroup>
  );
}

function ValOptional({
  path,
  source,
  schema,
}: {
  path: SourcePath;
  source: Json;
  schema: SerializedSchema;
}) {
  const [enable, setEnable] = useState<boolean>(source !== null);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div></div>
        <div>
          <input
            type="checkbox"
            checked={enable}
            onClick={() => {
              setEnable((prev) => !prev);
            }}
          />
        </div>
      </div>
      {enable && <ValDefaultOf source={source} schema={schema} path={path} />}
    </div>
  );
}

function ValDefaultOf({
  source,
  path,
  schema,
}: {
  source: Json | null;
  path: SourcePath;
  schema: SerializedSchema;
}): React.ReactElement {
  if (schema.type === "array") {
    return <ValArray source={source} path={path} schema={schema} />;
  } else if (schema.type === "object") {
    return <ValObject source={source} path={path} schema={schema} />;
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
      <div
        onClick={() => {
          setSelectedModuleId(moduleId);
        }}
      >
        {name}
      </div>
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
