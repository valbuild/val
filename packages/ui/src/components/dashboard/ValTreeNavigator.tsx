import { Internal, SerializedModule, SourcePath } from "@valbuild/core";
import { Json, JsonArray } from "@valbuild/core/src/Json";
import classNames from "classnames";
import { Dispatch, FC, SetStateAction, useEffect, useState } from "react";
import Chevron from "../../assets/icons/Chevron";
import { PatchJSON } from "@valbuild/core/patch";
import { ValApi } from "@valbuild/react";

const ValTreeArrayModuleItem: FC<{
  submodule: Json;
  selectedModule: string;
  setSelectedModule: Dispatch<SetStateAction<string>>;
  idx: number;
  path: string;
  reOrder: (oldIdx: number, newIdx: number) => void;
}> = ({ submodule, selectedModule, setSelectedModule, idx, path, reOrder }) => {
  const title = resolveTitle(submodule);
  return (
    <div
      className="w-fit"
      draggable
      id={idx.toString()}
      onDragStart={(ev) => {
        console.log("drag start", idx, ev);
      }}
    >
      <div className="flex gap-4">
        <button
          onClick={() => setSelectedModule(path + idx.toString())}
          className={classNames(
            "px-4 py-2 text-start hover:bg-light-gray/20 hover:rounded-lg",
            {
              "font-extrabold ":
                module.path + idx.toString() === selectedModule,
            }
          )}
        >
          {title}
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => reOrder(idx, idx + 1)}
            className="disabled:text-dark-gray"
          >
            <Chevron className="rotate-90" />
          </button>
          <button
            onClick={() => reOrder(idx, idx - 1)}
            className="disabled:text-dark-gray"
          >
            <Chevron className="-rotate-90" />
          </button>
        </div>
      </div>
    </div>
  );
};

const DEFAULT_TITLE = "Untitled";
function resolveTitle(submodule: Json): string {
  if (!submodule) {
    return DEFAULT_TITLE;
  }
  if (typeof submodule === "string") {
    return submodule;
  }
  if (typeof submodule === "object") {
    if ("title" in submodule && typeof submodule.title === "string") {
      return submodule.title;
    }
    if ("name" in submodule && typeof submodule.name === "string") {
      return submodule.name;
    }
    const firstStringField = Object.entries(submodule).find(([, value]) => {
      return typeof value === "string";
    })?.[1];
    if (typeof firstStringField === "string") {
      return firstStringField;
    }
  }
  return DEFAULT_TITLE;
}

const ValTreeNavigatorArrayModule: FC<{
  module: SerializedModule;
  selectedModule: string;
  setSelectedModule: Dispatch<SetStateAction<string>>;
  valApi: ValApi;
}> = ({ module, selectedModule, setSelectedModule, valApi }) => {
  const [collapsed, setCollapsed] = useState(true);
  const [items, setItems] = useState<Json[]>(
    (module.source as JsonArray).map((submodule) => submodule as Json)
  );
  const [reOrderMode, setReOrderMode] = useState(false);

  const reOrder = async (oldIndex: number, newIndex: number) => {
    const sanitizedNewIndex =
      newIndex < 0 ? items.length - 1 : newIndex % items.length;
    const path = module.path + oldIndex.toString();
    const newPath = module.path + newIndex.toString();
    const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(
      path as SourcePath
    );

    const [newModuleId, newModulePath] = Internal.splitModuleIdAndModulePath(
      newPath as SourcePath
    );
    const patch: PatchJSON = [
      {
        op: "move",
        from: `/${modulePath
          .split(".")
          .map((p) => {
            return JSON.parse(p);
          })
          .join("/")}`,
        path: `/${newModulePath
          .split(".")
          .map((p) => {
            return JSON.parse(p);
          })
          .join("/")}`,
      },
    ];
    await valApi.patchModuleContent(moduleId, patch);
    if (selectedModule === path) {
      setSelectedModule(`${newModuleId}.${newModulePath}`);
    }
    setItems((items) => {
      const newItems = [...items];
      const item = newItems.splice(oldIndex, 1)[0];
      newItems.splice(sanitizedNewIndex, 0, item);
      return newItems;
    });
  };

  const toggleReorderMode = () => {
    setReOrderMode(!reOrderMode);
    if (collapsed) setCollapsed(false);
  };

  return (
    <div className="relative flex flex-col gap-3">
      <div className="flex items-center justify-between ">
        <button
          className="flex items-center justify-between px-4 py-2 hover:bg-light-gray/20 hover:rounded-lg "
          onClick={() => setCollapsed(!collapsed)}
        >
          <div className="flex items-center gap-2">
            <Chevron className={classNames({ "rotate-90": !collapsed })} />
            <h1 className="text-xl">{module.path}</h1>
          </div>
        </button>
        <div className="flex gap-2">
          <button
            className="relative w-[20px] h-[20px] flex flex-col justify-between items-center"
            onClick={toggleReorderMode}
          >
            <Chevron className="top-0 -rotate-90" />
            <Chevron className="rotate-90 " />
          </button>
          <button className="text-2xl w-[20px] h-[20px] rounded-full flex justify-center items-center">
            +
          </button>
        </div>
      </div>

      {!collapsed &&
        items.map((submodule, idx) => (
          <ValTreeArrayModuleItem
            submodule={submodule}
            idx={idx}
            selectedModule={selectedModule}
            setSelectedModule={setSelectedModule}
            path={module.path}
            key={idx}
            reOrder={reOrder}
          />
        ))}
    </div>
  );
};

const ValTreeNavigatorModule: FC<{
  module: SerializedModule;
  setSelectedModule: Dispatch<SetStateAction<string>>;
}> = ({ module, setSelectedModule }) => {
  return (
    <div className="relative flex flex-col gap-3 px-4 py-2 hover:bg-light-gray/20 hover:rounded-lg ">
      <button
        className="flex items-center justify-between"
        onClick={() => setSelectedModule(module.path)}
      >
        <div className="flex items-center gap-2">
          <Chevron className={classNames("opacity-0")} />
          <h1 className="text-xl">{module.path}</h1>
        </div>
      </button>
    </div>
  );
};

interface ValTreeNavigator {
  modules: SerializedModule[];
  selectedModule: string;
  setSelectedModule: Dispatch<SetStateAction<string>>;
  valApi: ValApi;
}
export const ValTreeNavigator: FC<ValTreeNavigator> = ({
  modules,
  selectedModule,
  setSelectedModule,
  valApi,
}) => {
  return (
    <div
      className={classNames("flex flex-col gap-4 font-serif text-lg px-4 py-3")}
    >
      {modules.map((module, idx) => (
        <div key={idx}>
          {module.schema.type === "array" ? (
            <ValTreeNavigatorArrayModule
              module={module}
              key={idx}
              selectedModule={selectedModule}
              setSelectedModule={setSelectedModule}
              valApi={valApi}
            />
          ) : (
            <ValTreeNavigatorModule
              module={module}
              setSelectedModule={setSelectedModule}
            />
          )}
        </div>
      ))}
    </div>
  );
};
