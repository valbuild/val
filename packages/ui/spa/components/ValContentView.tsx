import {
  Internal,
  ModuleFilePath,
  PatchId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { Json } from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { Grid } from "./Grid";
import React from "react";
import Logo from "../assets/icons/Logo";
import { ScrollArea } from "./ui/scroll-area";
import { ChevronLeft } from "lucide-react";
import { ValUIContext } from "./ValUIContext";
import { useTheme } from "./useTheme";
import { useSession } from "./useSession";
import { Path } from "./Path";
import { AnyVal, PathTree, ValImagePreviewContext } from "./ValCompositeFields";
import { InitOnSubmit } from "./ValFormField";
import { ValSession, ValStore } from "@valbuild/shared/internal";
import { result } from "@valbuild/core/fp";
import { useParams } from "./ValRouter";
import { Button } from "./ui/button";
import { ValStoreProvider } from "./ValStoreContext";
import { Dialog, DialogContent } from "./ui/dialog";
import { Remote } from "../utils/Remote";

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
      const applyRes = await store.applyPatch(moduleFilePath, patches, patch);
      if (result.isOk(applyRes)) {
        const allAppliedPatches = patches
          .slice()
          .concat(applyRes.value.newPatchId);
        setPatches(allAppliedPatches);
      }
      // TODO: applyRes error
    },
    [patches]
  );

  const [loading, setLoading] = useState(false);
  const [moduleError, setModuleError] = useState<string>();
  const [rootModule, setRootModule] = useState<{
    source: Json;
    schema: SerializedSchema;
  } | null>(null);
  const [moduleFilePath] = selectedPath
    ? Internal.splitModuleFilePathAndModulePath(selectedPath)
    : [undefined, undefined];
  useEffect(() => {
    setRootModule(null);
    setModuleError(undefined);
    if (moduleFilePath) {
      setLoading(true);
    }
  }, [moduleFilePath]);
  useEffect(() => {
    let ignore = false;
    if (moduleFilePath) {
      store
        .reset()
        .then(async () => {
          const res = await store.getModule(moduleFilePath);
          if (!ignore) {
            if (session.status === "success") {
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
  }, [moduleFilePath, selectedPath, session, patches]);

  useEffect(() => {
    api.getPatches({ omitPatches: true }).then((res) => {
      if (result.isOk(res)) {
        const patches: PatchId[] = [];
        for (const [patchId, patchData] of Object.entries(res.value.patches)) {
          if (!patchData.appliedAt) {
            patches.push(patchId as PatchId);
          }
        }
        setPatches(patches);
      } else {
        console.error("Could not get patches", res.error);
      }
    });
  }, []);
  const portal = useRef<HTMLDivElement>(null);

  return (
    <ValStoreProvider store={store}>
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
          <div ref={portal}></div>
          <div id="val-fullscreen-hover" ref={hoverElemRef} />
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
                <div className="flex items-center justify-between h-[50px] w-full px-4">
                  <div className="flex items-center justify-start gap-2 font-serif text-xs">
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
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        // go to root
                        window.location.href = "/";
                      }}
                    >
                      Preview
                    </Button>
                    <Button
                      disabled={
                        !(session.status === "success") || patches.length === 0
                      }
                      onClick={() => {
                        api
                          .postSave({ patchIds: patches })
                          .then(async (res) => {
                            if (result.isOk(res)) {
                              const res = await api.deletePatches(patches);
                              if (result.isOk(res)) {
                                setPatches([]);
                                alert("Success");
                              } else {
                                setError("Could not clean up");
                              }
                            } else {
                              setError("Could not publish");
                            }
                          });
                      }}
                    >
                      Publish {patches.length > 0 && `(${patches.length})`}
                    </Button>
                  </div>
                </div>
                <div className="max-w-xl p-4">
                  <LoginModal
                    session={session}
                    portal={portal.current}
                    api={api}
                  />
                  {moduleError && (
                    <div className="p-4 text-lg bg-destructive text-destructive-foreground">
                      ERROR: {moduleError}
                    </div>
                  )}
                  {loading && (
                    <div className="flex place-content-center">Loading...</div>
                  )}
                  {rootModule && selectedPath && (
                    <ValModule
                      path={selectedPath}
                      source={rootModule.source}
                      schema={rootModule.schema}
                      initOnSubmit={initOnSubmit}
                    />
                  )}
                </div>
              </Grid>
            </div>
          </ValImagePreviewContext.Provider>
        </div>
      </ValUIContext.Provider>
    </ValStoreProvider>
  );
};

function LoginModal({
  api,
  session,
  portal,
}: {
  api: ValApi;
  session: Remote<ValSession>;
  portal: HTMLDivElement | null;
}) {
  const isUnauthorized =
    session.status === "success" && session.data.mode === "unauthorized";
  return (
    <Dialog open={isUnauthorized}>
      <DialogContent
        container={portal}
        className="flex items-center justify-center p-0 border-t-0"
        hideClose
      >
        <div className="flex flex-col items-center justify-center w-full gap-4 pb-4">
          <h1 className="w-full py-2 text-lg font-bold text-center border-t rounded-t bg-accent text-primary">
            Login required
          </h1>
          <p>You need to login to continue</p>
          <Button asChild>
            <a href={api.getLoginUrl(window?.location?.href || "/val")}>
              Login
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
