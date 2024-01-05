import {
  ApiTreeResponse,
  Internal,
  ModuleId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { Json } from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import { FC, useCallback, useEffect, useState } from "react";
import { Grid } from "./Grid";
import { result } from "@valbuild/core/fp";
import { OnSubmit } from "./ValFormField";
import React from "react";
import Logo from "../assets/icons/Logo";
import { ScrollArea } from "./ui/scroll-area";
import { ChevronLeft } from "lucide-react";
import { ValUIContext } from "./ValUIContext";
import { useNavigate, useParams } from "react-router";
import { useTheme } from "./useTheme";
import { ValMenu } from "./ValMenu";
import { usePatches } from "./usePatch";
import { useSession } from "./useSession";
import { Path } from "./Path";
import { ValPatches } from "./ValPatches";
import { AnyVal, PathTree, ValImagePreviewContext } from "./ValCompositeFields";

interface ValFullscreenProps {
  api: ValApi;
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

export type InitOnSubmit = (path: SourcePath) => OnSubmit;
export const ValFullscreen: FC<ValFullscreenProps> = ({ api }) => {
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
  const fatalErrors = Object.entries(modules || {}).flatMap(([id, module]) => {
    return module.errors
      ? module.errors.fatal
        ? module.errors.fatal.map((e) => ({ id, ...e }))
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
            .map((f, i) => `${i + 1}. [${f.id}]: ${f.message}`)
            .join("\n")}\n\nShowing stack trace of: 1. ${
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
    api
      .getTree({ patch: true, includeSchema: true, includeSource: true })
      .then((res) => {
        if (result.isOk(res)) {
          setModules(res.value.modules);
        } else {
          setError("Could not load modules: " + res.error.message);
          console.error(res.error);
        }
      });
  }, [hmrHash]);
  const session = useSession(api);

  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const { patches, setPatchResetId } = usePatches(session, api);

  const hoverElemRef = React.useRef<HTMLDivElement | null>(null);

  const initOnSubmit: InitOnSubmit = useCallback(
    (path) => async (callback) => {
      const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(path);
      const patch = await callback(Internal.createPatchJSONPath(modulePath));
      return api
        .postPatches(moduleId, patch)
        .then((res) => {
          if (result.isErr(res)) {
            throw res.error;
          } else {
            // TODO: we need to revisit this a bit, HMR might not be the best solution here
            if (!hmrHash) {
              setPatchResetId((prev) => prev + 1);
              return api
                .getTree({
                  treePath: moduleId,
                  patch: true,
                  includeSchema: true,
                  includeSource: true,
                })
                .then((res) => {
                  if (result.isOk(res)) {
                    setModules((modules) => ({
                      ...modules,
                      ...res.value.modules,
                    }));
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
  const [patchModalOpen, setPatchModalOpen] = useState(false);

  const allModuleIds = Object.entries(modules || {}).flatMap(
    ([moduleId, valModule]) => {
      if (valModule?.schema && valModule?.source) {
        return [moduleId];
      } else if (valModule?.errors) {
        return [moduleId];
      }
      return [];
    }
  );

  return (
    <ValUIContext.Provider
      value={{
        theme,
        setTheme,
        editMode: "full",
        session,
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
        className="relative w-full h-[100] overflow-hidden font-serif antialiased bg-background text-primary"
        data-mode={theme}
      >
        {patchModalOpen && (
          <div className="fixed z-5 top-[16px] left-[16px] w-[calc(100%-32px-50px-16px)] h-[calc(100svh-32px)]">
            <ValPatches
              patches={patches}
              api={api}
              onCancel={() => {
                setPatchModalOpen(false);
              }}
              onCommit={() => {
                setPatchResetId((patchResetId) => patchResetId + 1);
              }}
            />
          </div>
        )}
        <div className="fixed -translate-y-1/2 right-4 top-1/2 z-overlay">
          <ValMenu
            direction="vertical"
            api={api}
            patches={patches}
            onClickPatches={() => setPatchModalOpen((prev) => !prev)}
          />
        </div>
        <div id="val-fullscreen-hover" ref={hoverElemRef}></div>
        <ValImagePreviewContext.Provider
          value={{
            hoverElem: hoverElemRef?.current,
          }}
        >
          <div className="text-primary">
            <Grid>
              <div className="px-4 h-[50px] flex items-center justify-center">
                <Logo />
              </div>
              <ScrollArea className="px-4">
                {modules ? (
                  <PathTree
                    selectedPath={selectedPath}
                    paths={allModuleIds}
                    setSelectedModuleId={(path) => {
                      navigate(path);
                    }}
                  />
                ) : (
                  !error && <div className="py-4">Loading...</div>
                )}
              </ScrollArea>
              <div className="flex items-center justify-start h-[50px] gap-2 font-serif text-xs">
                <button
                  onClick={() => {
                    history.back();
                  }}
                >
                  <ChevronLeft />
                </button>
                <div
                  className="truncate max-w-[300px] text-left"
                  dir="rtl"
                  title={selectedPath}
                >
                  <Path>{selectedPath || "/"}</Path>
                </div>
              </div>
              <div className="p-4">
                {error && (
                  <div className="max-w-xl p-4 text-lg bg-destructive text-destructive-foreground">
                    ERROR: {error}
                  </div>
                )}
                {session.status === "success" &&
                  session.data.mode === "unauthorized" && (
                    <div className="max-w-xl p-4 text-lg bg-destructive text-destructive-foreground">
                      Not authorized
                    </div>
                  )}
                {session.status === "success" &&
                  session.data.mode !== "unauthorized" &&
                  modules &&
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
        </ValImagePreviewContext.Provider>
      </div>
    </ValUIContext.Provider>
  );
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
