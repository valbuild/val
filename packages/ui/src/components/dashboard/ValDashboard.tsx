"use client";

import { SerializedModule } from "@valbuild/core";
import { Json } from "@valbuild/core/src/Json";
import { ValApi } from "@valbuild/core";
import { FC, useEffect, useState } from "react";
import { Dropdown } from "./Dropdown";
import { FormGroup } from "./FormGroup";
import { Grid } from "./Grid";
import { Tree } from "./Tree";

interface ValDashboardProps {
  showDashboard: boolean;
  editMode: boolean;
  valApi: ValApi;
}
export const ValDashboard: FC<ValDashboardProps> = ({
  showDashboard,
  editMode,
}) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [modules, setModules] = useState<SerializedModule[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [selectedModule, setSelectedModule] = useState<
    | {
        [key: string]: {
          path: string;
          type: string;
        };
      }[]
    | undefined
  >();

  useEffect(() => {
    // valApi.getModules({ patch: true, includeSource: true }).then((modules) => {
    //   // TODO:
    // });
  }, []);

  useEffect(() => {
    const newModule = modules.find((module) => module.path === selectedPath);
    if (newModule) {
      const children = mapChildren(newModule);
      console.log("children", children);
      setSelectedModule(children);
    }
  }, [selectedPath]);

  const mapChildren = (module: SerializedModule) => {
    if (module) {
      if (module.schema.type === "array") {
        return (module.source as Json[]).map((child) => {
          const newModule: {
            [key: string]: {
              path: string;
              type: string;
            };
          } = {};
          if (child) {
            for (const key of Object.keys(child)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const type = (module.schema as any).item.items[key]
                .type as string;
              if (key !== "rank" && type !== "richtext") {
                newModule[key] = {
                  path: key,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  type: (module.schema as any).item.items[key].type as string,
                };
              }
            }
          }
          return newModule;
        });
      } else {
        const child = module.source as Json;
        const newModule: {
          [key: string]: {
            path: string;
            type: string;
          };
        } = {};
        if (child) {
          for (const key of Object.keys(child)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const type = (module.schema as any).items[key].type as string;
            if (key !== "rank" && type !== "richtext") {
              newModule[key] = {
                path: key,
                type: type,
              };
            }
          }
        }
        return [newModule];
      }
    }
  };

  return (
    <>
      {showDashboard && editMode && (
        <div className="bg-base w-screen fixed z-10 top-[68.54px] text-white overflow-hidden">
          <Grid>
            {modules && (
              <Dropdown
                options={modules.map((module) => module.path)}
                onClick={(path) => setSelectedPath(path)}
              />
            )}
            {selectedModule && (
              <Tree>
                {selectedModule.map((child, idx) => {
                  return (
                    <Tree.Node
                      key={idx}
                      path={`Section ${idx + 1}`}
                      type="section"
                    >
                      {Object.values(child).map((value, idx2) => (
                        <Tree.Node
                          key={idx2}
                          path={value.path}
                          type={value.type as "string" | "image" | "section"}
                        />
                      ))}
                    </Tree.Node>
                  );
                })}
              </Tree>
            )}
            <div className="flex items-center justify-between w-full h-full px-3 font-serif text-xs text-white">
              <p>Content</p>
              <button className="flex justify-between flex-shrink-0 gap-1">
                <span className="w-fit">+</span>
                <span className="w-fit">Add item</span>
              </button>
            </div>
            <FormGroup>
              <div>test</div>
              <div>test</div>
              <div>test</div>
            </FormGroup>
            <div>content</div>
          </Grid>
        </div>
      )}
    </>
  );
};
