"use client";
import {
  Internal,
  ModuleId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { Json } from "@valbuild/core/src/Json";
import { ValApi } from "@valbuild/core";
import { FC, useEffect, useState } from "react";
import { Grid } from "./Grid";
import { result } from "@valbuild/core/fp";
import { Tree } from "./Tree";

interface ValDashboardProps {
  valApi: ValApi;
}
export const ValDashboard: FC<ValDashboardProps> = ({ valApi }) => {
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
          {modules && selectedModuleId && (
            <pre>{JSON.stringify(modules[selectedModuleId], null, 2)}</pre>
          )}
        </div>
      </Grid>
    </div>
  );
};

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
