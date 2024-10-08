import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { EditMode, ValUIContext, WindowSize } from "../ValUIContext";
import { Remote } from "../../utils/Remote";
import { result } from "@valbuild/core/fp";
import {
  Internal,
  Json,
  PatchId,
  SerializedSchema,
  SourcePath,
} from "@valbuild/core";
import { useTheme } from "../useTheme";
import { useSession } from "../useSession";
import { AnyVal } from "../fields/ValCompositeFields";
import { InitOnSubmit } from "../fields/ValFormField";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover } from "../ui/popover";
import { ValClient, ValCache } from "@valbuild/shared/internal";
import { ValCacheProvider } from "../ValCacheContext";
import { ValMenu } from "./ValMenu";
import { ValWindow } from "./ValWindow";

export type ValOverlayProps = {
  defaultTheme?: "dark" | "light";
  client: ValClient;
  cache: ValCache;
  onSubmit: (refreshRequired: boolean) => void;
};

export function ValOverlay({
  defaultTheme,
  client,
  cache,
  onSubmit: reloadPage,
}: ValOverlayProps) {
  const [theme, setTheme] = useTheme(defaultTheme);
  const session = useSession(client);

  const [editMode, setEditMode] = useInitEditMode();
  const [hoverTarget, setHoverTarget] = useHoverTarget(editMode);
  const [windowTarget, setWindowTarget] = useState<WindowTarget | null>(null);
  const paths = windowTarget?.path ? windowTarget.path.split(",") : [];

  const lastResetPatchesId = useRef("");
  const currentPatchesId = useRef("");
  useEffect(() => {
    cache.reset();
    const valStoreListener = (event: Event) => {
      if (event instanceof CustomEvent) {
        if (event.detail.type === "reload-paths") {
          // Avoid reloading unless the patches have changed since last time reload was called
          // This would lead to an infinite loop
          if (lastResetPatchesId.current !== currentPatchesId.current) {
            lastResetPatchesId.current = currentPatchesId.current;
            cache.reloadPaths(event.detail.paths);
          }
        } else {
          console.error("Val: invalid store event", event);
        }
      }
    };
    window.addEventListener("val-store", valStoreListener);
    return () => {
      window.removeEventListener("val-store", valStoreListener);
    };
  }, [cache]);

  const [formData, setFormData] = useState<ValData>(
    Object.fromEntries(
      paths.map((path) => {
        return [path, { status: "not-asked" }] as const;
      }),
    ),
  );
  useEffect(() => {
    setFormData(
      Object.fromEntries(paths.map((path) => [path, { status: "loading" }])),
    );
    async function load() {
      const entries = await Promise.all(
        paths.map(async (path) => {
          const [moduleFilePath, modulePath] =
            Internal.splitModuleFilePathAndModulePath(path as SourcePath);
          const res = await cache.getModule(moduleFilePath, false);
          if (result.isErr(res)) {
            return [
              moduleFilePath,
              { status: "error", error: res.error.message },
            ] as const;
          } else {
            const { source, schema } = res.value;
            if (!source || !schema) {
              return [
                moduleFilePath,
                {
                  status: "error",
                  error: "Val could load this content. Please try again.",
                },
              ] as const;
            } else {
              const resolved = Internal.resolvePath(modulePath, source, schema);
              if (!resolved.source || !resolved.schema) {
                return [
                  moduleFilePath,
                  {
                    status: "error",
                    error:
                      "Val could not internally resolve this content. This is possibly due to a misconfiguration or a bug in Val.",
                  },
                ] as const;
              }
              return [
                path,
                {
                  status: "success",
                  data: { source: resolved.source, schema: resolved.schema },
                },
              ] as const;
            }
          }
        }),
      );
      setFormData(Object.fromEntries(entries));
    }
    load();
  }, [paths.join(";")]);

  const [windowSize, setWindowSize] = useState<WindowSize>();
  const [patches, setPatches] = useState<PatchId[]>([]);
  useEffect(() => {
    currentPatchesId.current = patches.map(String).join(";");
  }, [patches]);

  useEffect(() => {
    client("/patches/~", "GET", {
      query: {
        omit_patch: true,
        author: [],
        patch_id: [],
        module_file_path: [],
      },
    })
      .then((res) => {
        if (res.status !== 200) {
          console.error("Val: could not parse patches", res.json);
          return;
        }
        setPatches(Object.keys(res.json.patches) as PatchId[]);
      })
      .catch((err) => {
        console.warn("Val: could not fetch patches", err);
      });
  }, []);

  const initOnSubmit: InitOnSubmit = useCallback(
    (path) => async (callback) => {
      const [moduleFilePath, modulePath] =
        Internal.splitModuleFilePathAndModulePath(path);
      const patch = await callback(Internal.createPatchPath(modulePath));
      const applyRes = await cache.applyPatch(moduleFilePath, patches, patch);
      if (result.isOk(applyRes)) {
        const allAppliedPatches = patches
          .slice()
          .concat(applyRes.value.newPatchId);
        setPatches(allAppliedPatches);
      }
      reloadPage(true);
    },
    [patches],
  );

  return (
    <ValCacheProvider cache={cache}>
      <ValUIContext.Provider
        value={{
          theme,
          session,
          editMode,
          setEditMode,
          setTheme,
          windowSize,
          setWindowSize,
        }}
      >
        <div
          id="val-overlay-container"
          data-mode={theme}
          className="font-serif antialiased"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            zIndex: 8999, // 1 less than the NextJS error z-index: 9000
          }}
        >
          <Popover>
            <PopoverPrimitive.Portal />
            <div className="fixed -translate-y-1/2 right-4 top-1/2 z-overlay">
              <ValMenu
                direction="vertical"
                patches={patches}
                onClickPatches={() => {
                  client("/save", "POST", { body: { patchIds: patches } }).then(
                    async (saveRes) => {
                      if (saveRes.status === 200) {
                        const res = await client("/patches/~", "DELETE", {
                          query: {
                            id: patches,
                          },
                        });
                        if (res.status === 200) {
                          setPatches([]);
                          await cache.reset();
                        } else {
                          alert("Could not clean up");
                        }
                      } else {
                        alert("Could not publish");
                      }
                    },
                  );
                }}
              />
            </div>
          </Popover>
          {session.status === "success" &&
            session.data.enabled &&
            (editMode === "hover" || editMode === "window") &&
            hoverTarget.path && (
              <ValHover
                hoverTarget={hoverTarget}
                setHoverTarget={setHoverTarget}
                setEditMode={setEditMode}
                setWindowTarget={setWindowTarget}
              />
            )}
          {editMode === "window" && windowTarget && (
            <ValWindow
              onClose={() => {
                setWindowTarget(null);
                setEditMode("hover");
              }}
            >
              <div
                className="p-4"
                style={{
                  maxHeight: windowSize?.innerHeight,
                  maxWidth: windowSize?.width,
                }}
              >
                {Object.entries(formData).map(([path, data]) => {
                  if (data.status !== "success") {
                    return (
                      <div key={path}>
                        <span>
                          {path}
                          {data.status !== "error" && (
                            <span>: {data.status}</span>
                          )}
                        </span>
                        {data.status === "error" && (
                          <pre className="text-red-600 whitespace-pre-wrap">
                            {data.error}
                          </pre>
                        )}
                      </div>
                    );
                  }
                  const { source, schema } = data.data;
                  if (!source || !schema) {
                    return (
                      <div>Module: {path} is missing source or schema</div>
                    );
                  }

                  return (
                    <AnyVal
                      initOnSubmit={initOnSubmit}
                      path={path as SourcePath}
                      key={path}
                      schema={schema}
                      source={source}
                      top
                    />
                  );
                })}
              </div>
            </ValWindow>
          )}
        </div>
      </ValUIContext.Provider>
    </ValCacheProvider>
  );
}

type ValData = Record<
  string,
  Remote<{
    source: Json | undefined;
    schema: SerializedSchema | undefined;
  }>
>;

type WindowTarget = {
  element?: HTMLElement | undefined;
  mouse: { x: number; y: number };
  path: SourcePath;
};

type HoverTarget = {
  element?: HTMLElement | undefined;
  path?: SourcePath;
};
function ValHover({
  hoverTarget,
  setEditMode,
  setWindowTarget,
  setHoverTarget,
}: {
  hoverTarget: HoverTarget;
  setEditMode: Dispatch<EditMode>;
  setHoverTarget: Dispatch<HoverTarget | null>;
  setWindowTarget: Dispatch<WindowTarget | null>;
}) {
  const rect = hoverTarget.element?.getBoundingClientRect();
  useEffect(() => {
    if (hoverTarget.path) {
      const clickListener = (ev: MouseEvent) => {
        if (
          ev.target &&
          ev.target instanceof HTMLElement &&
          ev.target.id !== "val-shadow-root"
        )
          setWindowTarget({
            ...hoverTarget,
            path: hoverTarget.path as SourcePath,
            mouse: { x: ev.pageX, y: ev.pageY },
          });
        setEditMode("window");
        setHoverTarget(null);
        ev.stopPropagation();
      };
      document.body.addEventListener("click", clickListener);
      return () => {
        document.body.removeEventListener("click", clickListener);
      };
    }
  }, [hoverTarget]);
  return (
    <div
      id="val-hover"
      className="fixed border-2 cursor-pointer z-overlay-hover border-accent"
      style={{
        pointerEvents: "none",
        top: rect?.top,
        left: rect?.left,
        width: rect?.width,
        height: rect?.height,
      }}
    >
      <div className="flex items-center justify-end w-full text-xs">
        <div
          className="flex items-center justify-center px-3 py-1 border-b-2 border-l-2 text-accent-foreground bg-accent border-accent"
          style={{
            maxHeight: rect?.height && rect.height - 4,
            fontSize:
              rect?.height && rect.height <= 16 ? rect.height - 4 : undefined,
          }}
        >
          Edit
        </div>
      </div>
    </div>
  );
}

function useHoverTarget(editMode: EditMode) {
  const [targetElement, setTargetElement] = useState<HTMLElement>();
  const [targetPath, setTargetPath] = useState<SourcePath>();
  const [targetRect, setTargetRect] = useState<DOMRect>();
  function tagElements(target: HTMLElement | null) {
    if (target) {
      const sourcePaths: string[] = [];
      if (target.dataset.valPath) {
        sourcePaths.push(target.dataset.valPath);
      }

      for (const element of Array.from(target.querySelectorAll("*"))) {
        if (element instanceof HTMLElement) {
          const sourcePath = element.dataset.valPath;
          if (sourcePath) {
            sourcePaths.push(sourcePath);
          }
        }
      }

      if (sourcePaths.length > 0) {
        setTargetElement(target);
        setTargetPath(sourcePaths.join(",") as SourcePath);
        setTargetRect(target.getBoundingClientRect());
      }
    }
  }
  useEffect(() => {
    if (editMode === "hover" || editMode === "window") {
      const mouseOverListener = (e: MouseEvent) => {
        tagElements(e.target as HTMLElement | null);
      };
      document.addEventListener("mouseover", mouseOverListener);

      return () => {
        setTargetElement(undefined);
        setTargetPath(undefined);
        document.removeEventListener("mouseover", mouseOverListener);
      };
    }
  }, [editMode]);

  useEffect(() => {
    const scrollListener = () => {
      if (targetElement) {
        setTargetRect(targetElement.getBoundingClientRect());
      }
    };
    const observer = new ResizeObserver(() => {
      if (targetElement) {
        setTargetRect(targetElement.getBoundingClientRect());
      }
    });
    const valUIElement = document.getElementById("val-shadow-root");
    if (targetElement && valUIElement) {
      observer.observe(valUIElement);
    }

    document.addEventListener("scroll", scrollListener, { passive: true });
    return () => {
      document.removeEventListener("scroll", scrollListener);
      observer.disconnect();
    };
  }, [targetElement]);

  return [
    {
      path: targetPath,
      element: targetElement,
      rect: targetRect,
    } as HoverTarget,
    (target: HoverTarget | null) => {
      setTargetElement(target?.element);
      setTargetPath(target?.path);
      setTargetRect(target?.element?.getBoundingClientRect());
    },
  ] as const;
}

const LOCAL_STORAGE_EDIT_MODE_KEY = "val-edit-mode";

function useInitEditMode() {
  const [editMode, setEditModeRaw] = useState<EditMode>("off");
  useEffect(() => {
    try {
      const storedEditMode = localStorage.getItem(LOCAL_STORAGE_EDIT_MODE_KEY);
      if (
        storedEditMode === "off" ||
        storedEditMode === "hover" ||
        storedEditMode === "window" ||
        storedEditMode === "full"
      ) {
        setEditModeRaw(storedEditMode === "window" ? "hover" : storedEditMode);
      } else {
        localStorage.removeItem(LOCAL_STORAGE_EDIT_MODE_KEY);
        setEditModeRaw("off");
      }
    } catch (err) {
      setEditModeRaw("off");
    }
  }, []);

  const setEditMode: Dispatch<SetStateAction<EditMode>> = useCallback((v) => {
    if (typeof v === "function") {
      setEditModeRaw((prev) => {
        const next = v(prev);
        localStorage.setItem(LOCAL_STORAGE_EDIT_MODE_KEY, next);
        return next;
      });
    } else {
      localStorage.setItem(LOCAL_STORAGE_EDIT_MODE_KEY, v);
      setEditModeRaw(v);
    }
  }, []);
  return [editMode, setEditMode] as const;
}
