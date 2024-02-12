import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ValMenu } from "./ValMenu";
import { EditMode, ValUIContext, WindowSize } from "./ValUIContext";
import { Remote } from "../utils/Remote";
import { ValWindow } from "./ValWindow";
import { result } from "@valbuild/core/fp";
import { Internal, Json, SerializedSchema, SourcePath } from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import { usePatches } from "./usePatch";
import { useTheme } from "./useTheme";
import { useSession } from "./useSession";
import { ValPatches } from "./ValPatches";
import { AnyVal } from "./ValCompositeFields";
import { InitOnSubmit } from "./ValFormField";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Popover } from "./ui/popover";
import { ValStore } from "@valbuild/shared/internal";

export type ValOverlayProps = {
  defaultTheme?: "dark" | "light";
  api: ValApi;
  store: ValStore;
  onSubmit: (refreshRequired: boolean) => void;
};

export function ValOverlay({
  defaultTheme,
  api,
  store,
  onSubmit: reloadPage,
}: ValOverlayProps) {
  const [theme, setTheme] = useTheme(defaultTheme);
  const session = useSession(api);

  const [editMode, setEditMode] = useInitEditMode();
  const [hoverTarget, setHoverTarget] = useHoverTarget(editMode);
  const [windowTarget, setWindowTarget] = useState<WindowTarget | null>(null);
  const paths = windowTarget?.path ? windowTarget.path.split(",") : [];

  const [formData, setFormData] = useState<ValData>(
    Object.fromEntries(
      paths.map((path) => {
        return [path, { status: "not-asked" }] as const;
      })
    )
  );
  useEffect(() => {
    setFormData(
      Object.fromEntries(paths.map((path) => [path, { status: "loading" }]))
    );
    async function load() {
      const entries = await Promise.all(
        paths.map(async (path) => {
          const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(
            path as SourcePath
          );
          const res = await store.getModule(moduleId, false);
          if (result.isErr(res)) {
            return [
              moduleId,
              { status: "error", error: res.error.message },
            ] as const;
          } else {
            const { source, schema } = res.value;
            if (!source || !schema) {
              return [
                moduleId,
                {
                  status: "error",
                  error: "Val could load this content. Please try again.",
                },
              ] as const;
            } else {
              const resolved = Internal.resolvePath(modulePath, source, schema);
              if (!resolved.source || !resolved.schema) {
                return [
                  moduleId,
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
        })
      );
      setFormData(Object.fromEntries(entries));
    }
    load();
  }, [paths.join(";")]);

  const [windowSize, setWindowSize] = useState<WindowSize>();
  useEffect(() => {
    store.reset();
  }, []);

  const { patches, setPatchResetId } = usePatches(session, api);

  const initOnSubmit: InitOnSubmit = useCallback(
    (path) => async (callback) => {
      const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(path);
      const patch = await callback(Internal.createPatchPath(modulePath));
      const applyRes = store.applyPatch(moduleId, patch);
      // TODO: applyRes
      setPatchResetId((prev) => prev + 1);
      reloadPage(true);
    },
    []
  );
  const [patchModalOpen, setPatchModalOpen] = useState(false);

  return (
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
        data-mode={theme}
        className="font-serif antialiased"
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          zIndex: 8999, // 1 less than the NextJS error z-index: 9000
        }}
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
        <Popover>
          <PopoverPrimitive.Portal />
          <div className="fixed -translate-y-1/2 right-4 top-1/2 z-overlay">
            <ValMenu
              direction="vertical"
              api={api}
              patches={patches}
              onClickPatches={() => setPatchModalOpen((prev) => !prev)}
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
                        {path}: {data.status}
                      </span>
                      {data.status === "error" && <pre>{data.error}</pre>}
                    </div>
                  );
                }
                const { source, schema } = data.data;
                if (!source || !schema) {
                  return <div>Module: {path} is missing source or schema</div>;
                }

                return (
                  <AnyVal
                    initOnSubmit={initOnSubmit}
                    path={path as SourcePath}
                    key={path}
                    schema={schema}
                    source={source}
                    setSelectedPath={() => {
                      // TODO: go to full screen
                    }}
                    top
                  />
                );
              })}
            </div>
          </ValWindow>
        )}
      </div>
    </ValUIContext.Provider>
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
          ev.target.id !== "val-ui"
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
    const valUIElement = document.getElementById("val-ui");
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
