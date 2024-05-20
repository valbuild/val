import {
  Internal,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { Json } from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import { FC, useCallback, useEffect, useState } from "react";
import { Grid } from "./Grid";
import React from "react";
import Logo from "../assets/icons/Logo";
import { ScrollArea } from "./ui/scroll-area";
import { ChevronLeft, Languages, Minimize2, Send } from "lucide-react";
import { ValUIContext } from "./ValUIContext";
import { useTheme } from "./useTheme";
import { useSession } from "./useSession";
import { Path } from "./Path";
import { AnyVal, PathTree, ValImagePreviewContext } from "./ValCompositeFields";
import { InitOnSubmit } from "./ValFormField";
import { ValSession, ValStore } from "@valbuild/shared/internal";
import { result } from "@valbuild/core/fp";
import { Remote } from "../utils/Remote";
import { useParams } from "./ValRouter";

interface ValFullscreenProps {
  api: ValApi;
  store: ValStore;
}

export const ValContentView: FC<ValFullscreenProps> = ({ api, store }) => {
  const [error, setError] = useState<string | null>(null);

  const params = useParams();
  const selectedPath = params.sourcePath || ("" as SourcePath);
  const [moduleFilePaths, setModuleFilePaths] = useState<ModuleFilePath[]>();
  const [initializationState, setInitializationState] = useState<
    "not-asked" | "running" | "complete" | "failed"
  >("not-asked");

  useEffect(() => {
    if (initializationState === "not-asked") {
      setInitializationState("running");
      store.initialize().then((res) => {
        if (result.isOk(res)) {
          setModuleFilePaths(res.value);
          setInitializationState("complete");
        } else {
          setError(res.error.message);
          setInitializationState("failed");
        }
      });
    }
  }, [initializationState]);
  const session = useSession(api);

  const [theme, setTheme] = useTheme();
  const hoverElemRef = React.useRef<HTMLDivElement | null>(null);
  const [patches, setPatches] = useState<PatchId[]>([]);

  const initOnSubmit: InitOnSubmit = useCallback(
    (path) => async (callback) => {
      const [moduleFilePath, modulePath] =
        Internal.splitModuleFilePathAndModulePath(path);
      const patch = await callback(Internal.createPatchPath(modulePath));
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const applyRes = await store.applyPatch(moduleFilePath, patches, patch);
      // TODO: applyRes
      if (result.isOk(applyRes)) {
        for (const patchData of Object.values(applyRes.value)) {
          patches.push(...patchData.patchIds);
        }
        setPatches(patches);
      }
    },
    [patches]
  );

  useEffect(() => {
    api.getPatches().then((res) => {
      if (result.isOk(res)) {
        const patches: PatchId[] = [];
        for (const patchData of Object.values(res.value).flat()) {
          patches.push(patchData.patch_id);
        }
        setPatches(patches);
      } else {
        console.error("Could not get patches", res.error);
      }
    });
  }, []);
  // TODO: validation
  // const [isValidating, setIsValidating] = useState(false);
  // const [validationResponse, setValidationResponse] =
  //   useState<ValPatchesProps["validationResponse"]>();

  // useEffect(() => {
  //   let ignore = false;
  //   if (moduleFilePaths !== undefined) {
  //     setIsValidating(true);
  //     api
  //       .postValidate({
  //         patches,
  //       })
  //       .then((res) => {
  //         if (!ignore) {
  //           if (result.isOk(res)) {
  //             setValidationResponse({
  //               globalError: null,
  //               validationErrors: res.value,
  //             });
  //           } else {
  //             setValidationResponse({
  //               globalError: {
  //                 message:
  //                   "Could not validate changes: check if Val is correctly setup.",
  //                 details: res.error,
  //               },
  //             });
  //           }
  //           setIsValidating(false);
  //         }
  //       })
  //       .catch((err) => {
  //         if (!ignore) {
  //           setValidationResponse({
  //             globalError: {
  //               message:
  //                 "Could not validate changes: check the internet connection.",
  //               details: err,
  //             },
  //           });
  //           setIsValidating(false);
  //         }
  //       });
  //   }
  //   return () => {
  //     ignore = true;
  //   };
  // }, [patches, moduleFilePaths]);

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
                {moduleFilePaths ? (
                  <PathTree
                    selectedPath={selectedPath}
                    paths={moduleFilePaths}
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
              <ModulePane
                path={selectedPath}
                error={error}
                initOnSubmit={initOnSubmit}
                session={session}
                api={api}
                store={store}
              />
              <div className="w-full flex items-center justify-end h-[50px] gap-2 font-serif text-xs px-6">
                {/* MENU */}

                <button className="px-4 py-2 border rounded border-border">
                  <Minimize2 size={14} />
                </button>
                <button className="px-4 py-2 border rounded border-border">
                  <Languages size={14} />
                </button>
                <button className="px-4 py-2 border rounded border-border bg-border">
                  <Send size={14} />
                </button>
              </div>
            </Grid>
          </div>
        </ValImagePreviewContext.Provider>
      </div>
    </ValUIContext.Provider>
  );
};

function ModulePane({
  path,
  api,
  store,
  error: globalError,
  session,
  initOnSubmit,
}: {
  path?: SourcePath | ModuleFilePath;
  api: ValApi;
  store: ValStore;
  error: string | null;
  session: Remote<ValSession>;
  initOnSubmit: InitOnSubmit;
}) {
  const [loading, setLoading] = useState(false);
  const [moduleError, setModuleError] = useState<string>();
  const [rootModule, setRootModule] = useState<{
    source: Json;
    schema: SerializedSchema;
  } | null>(null);
  const [moduleId] = path
    ? Internal.splitModuleFilePathAndModulePath(path as SourcePath)
    : [undefined, undefined];
  useEffect(() => {
    let ignore = false;
    if (moduleId) {
      setRootModule(null);
      setLoading(true);
      setModuleError(undefined);
      store
        .getModule(moduleId)
        .then((res) => {
          if (!ignore) {
            if (session.status === "success" && session.data.enabled) {
              if (result.isOk(res)) {
                setRootModule(res.value);
              } else {
                setModuleError(res.error.message);
              }
            }
          }
        })
        .finally(() => {
          if (!ignore) {
            setLoading(false);
          }
        });
    } else {
      setRootModule(null);
    }
    return () => {
      ignore = true;
    };
  }, [moduleId, path, session]);

  return (
    <div className="p-4">
      {(globalError || moduleError) && (
        <div className="max-w-xl p-4 text-lg bg-destructive text-destructive-foreground">
          ERROR: {globalError || moduleError}
        </div>
      )}
      {session.status === "success" && session.data.mode === "unauthorized" && (
        <div className="max-w-xl p-4 text-lg bg-destructive text-destructive-foreground">
          Not authorized
        </div>
      )}
      {session.status === "success" && !session.data.enabled && (
        <div className="max-w-xl p-4 text-lg">
          <div>Val is currently not enabled</div>
          <a href={api.getEnableUrl(window?.location?.href || "/val")}>
            Enable Val
          </a>
        </div>
      )}
      {loading && <div className="flex place-content-center">Loading...</div>}
      {rootModule && path && (
        <ValModule
          path={path}
          source={rootModule.source}
          schema={rootModule.schema}
          initOnSubmit={initOnSubmit}
        />
      )}
    </div>
  );
}

function ValModule({
  path,
  source: moduleSource,
  schema: moduleSchema,
  initOnSubmit,
}: {
  path: SourcePath | ModuleFilePath;
  source: Json;
  schema: SerializedSchema;
  initOnSubmit: InitOnSubmit;
}): React.ReactElement {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    path as SourcePath
  );
  const resolvedPath = Internal.resolvePath(
    modulePath,
    moduleSource,
    moduleSchema
  );
  if (!resolvedPath) {
    console.error("Could not resolve module: " + path, {
      modulePath,
      moduleSource,
      moduleSchema,
    });
    throw Error("Could not resolve module: " + path);
  }

  return (
    <AnyVal
      path={path as SourcePath}
      source={resolvedPath.source}
      schema={resolvedPath.schema as SerializedSchema}
      initOnSubmit={initOnSubmit}
      top
    />
  );
}
