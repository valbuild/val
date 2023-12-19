import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useState,
} from "react";
import { ValMenu } from "./ValMenu";
import { EditMode, ValOverlayContext, WindowSize } from "./ValOverlayContext";
import { Remote } from "../utils/Remote";
import { ValWindow } from "./ValWindow";
import { result } from "@valbuild/core/fp";
import { Internal, Json, SerializedSchema, SourcePath } from "@valbuild/core";
import { ValApi } from "@valbuild/core";
import { usePatchSubmit, usePatches } from "./usePatch";
import { useTheme } from "./useTheme";
import { IValStore } from "../lib/IValStore";
import { ScrollArea } from "./ui/scroll-area";
import { AnyVal } from "./ValFullscreen";
import { InitOnSubmit } from "./ValFullscreen";
import { useSession } from "./useSession";

export type ValOverlayProps = {
  defaultTheme?: "dark" | "light";
  api: ValApi;
  store: IValStore;
  onSubmit: (refreshRequired: boolean) => void;
};

export function ValOverlay({
  defaultTheme,
  api,
  store,
  onSubmit,
}: ValOverlayProps) {
  const [theme, setTheme] = useTheme(defaultTheme);
  const session = useSession(api);

  const [editMode, setEditMode] = useInitEditMode();
  const [hoverTarget, setHoverTarget] = useHoverTarget(editMode);
  const [windowTarget, setWindowTarget] = useState<WindowTarget | null>(null);
  const [highlight, setHighlight] = useState(false);
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
    for (const path of paths) {
      updateFormData(api, path, setFormData);
    }
  }, [paths.join(";")]);

  const selectedPaths = windowTarget?.path ? (paths as SourcePath[]) : [];
  const {
    onSubmitPatch,
    // progress: patchProgress,
    error: patchError,
  } = usePatchSubmit(selectedPaths, api, store, onSubmit, session);

  const [windowSize, setWindowSize] = useState<WindowSize>();
  useEffect(() => {
    store.updateAll();
  }, []);

  useEffect(() => {
    if (patchError) {
      console.error(patchError);
    }
  }, [patchError]);

  const { patches, setPatchResetId } = usePatches(session, api);

  const initOnSubmit: InitOnSubmit = useCallback(
    (path) => async (callback) => {
      const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(path);
      const patch = await callback(Internal.createPatchJSONPath(modulePath));
      await api.postPatches(moduleId, patch);
      setPatchResetId((patchResetId) => patchResetId + 1);
      return onSubmitPatch()
        .then(() => store.update([moduleId]))
        .then(() => {
          updateFormData(api, path, setFormData);
        });
    },
    []
  );

  return (
    <ValOverlayContext.Provider
      value={{
        api,
        theme,
        session,
        editMode,
        setEditMode,
        highlight,
        setHighlight,
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
        <div className="fixed -translate-y-1/2 right-4 top-1/2 z-overlay">
          <ValMenu
            direction="vertical"
            api={api}
            patches={patches}
            onCommit={() => {
              setPatchResetId((patchResetId) => patchResetId + 1);
            }}
          />
        </div>
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
                      {path}: {data.status}
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
    </ValOverlayContext.Provider>
  );
}

type ValData = Record<
  string,
  Remote<{
    source: Json | undefined;
    schema: SerializedSchema | undefined;
  }>
>;

// TODO: smells bad:
function updateFormData(
  api: ValApi,
  path: string,
  setData: Dispatch<SetStateAction<ValData>>
) {
  const [moduleId, modulePath] = Internal.splitModuleIdAndModulePath(
    path as SourcePath
  );
  api
    .getTree({
      patch: true,
      includeSchema: true,
      includeSource: true,
      treePath: moduleId,
    })
    .then((res) => {
      if (result.isOk(res)) {
        const { schema, source } = res.value.modules[moduleId];
        if (!schema || !source) {
          return setData((prev) => ({
            ...prev,
            [path]: {
              status: "success",
              data: {
                source: res.value.modules[moduleId].source,
                schema: res.value.modules[moduleId].schema,
              },
            },
          }));
        }

        const resolvedModulePath = Internal.resolvePath(
          modulePath,
          source,
          schema
        );

        setData((prev) => ({
          ...prev,
          [path]: {
            status: "success",
            data: {
              source: resolvedModulePath.source,
              schema: resolvedModulePath.schema,
            },
          },
        }));
      } else {
        console.error({ status: "error", error: res.error });
        setData((prev) => ({
          ...prev,
          [path]: {
            status: "error",
            error: res.error.message,
          },
        }));
      }
    });
}

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
  return (
    <div
      id="val-hover"
      className="fixed border-2 cursor-pointer z-overlay-hover border-accent"
      style={{
        top: rect?.top,
        left: rect?.left,
        width: rect?.width,
        height: rect?.height,
      }}
      onClick={(ev) => {
        if (hoverTarget.path) {
          setWindowTarget({
            ...hoverTarget,
            path: hoverTarget.path as SourcePath,
            mouse: { x: ev.pageX, y: ev.pageY },
          });
          setEditMode("window");
          setHoverTarget(null);
        }
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
  useEffect(() => {
    if (editMode === "hover" || editMode === "window") {
      let curr: HTMLElement | null = null;
      const mouseOverListener = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        curr = target;
        // TODO: use .contains?
        do {
          if (curr?.dataset.valPath) {
            setTargetElement(curr);
            setTargetPath(curr.dataset.valPath as SourcePath);
            setTargetRect(curr.getBoundingClientRect());
            break;
          }
        } while ((curr = curr?.parentElement || null));
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

// TODO: do something fun on highlight?
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function useHighlight(
  highlight: boolean,
  setTarget: Dispatch<HoverTarget | null>
) {
  useEffect(() => {
    if (highlight) {
      const elements =
        document.querySelectorAll<HTMLElement>("[data-val-path]");
      let index = 0;
      let timeout: NodeJS.Timeout | null = null;

      const highlight = () => {
        const element = elements[index];
        const path = element.dataset.valPath as SourcePath;
        if (path) {
          setTarget({
            path,
            element,
          });
        }
        index++;
        if (index >= elements.length) {
          index = 0;
        }
        timeout = setTimeout(highlight, 1000);
      };
      highlight();
      return () => {
        if (timeout) {
          clearTimeout(timeout);
        }
      };
    }
  }, [highlight]);
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
