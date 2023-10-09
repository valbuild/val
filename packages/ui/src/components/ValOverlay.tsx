import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Session } from "../dto/Session";
import { ValMenu } from "./ValMenu";
import { EditMode, Theme, ValOverlayContext } from "./ValOverlayContext";
import { Remote } from "../utils/Remote";
import { ValWindow } from "./ValWindow";
import { result } from "@valbuild/core/fp";
import {
  AnyRichTextOptions,
  FileSource,
  Internal,
  RichText,
  SerializedSchema,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/core";
import { Modules, resolvePath } from "../utils/resolvePath";
import { ValApi } from "@valbuild/core";
import { RichTextEditor } from "../exports";
import { LexicalEditor } from "lexical";
import { LexicalRootNode, fromLexical } from "./RichTextEditor/conversion";
import { PatchJSON } from "@valbuild/core/patch";

export type ValOverlayProps = {
  defaultTheme?: "dark" | "light";
  api: ValApi;
};

type ImageSource = FileSource<{
  height: number;
  width: number;
  sha256: string;
}>;

export function ValOverlay({ defaultTheme, api }: ValOverlayProps) {
  const [theme, setTheme] = useTheme(defaultTheme);
  const session = useSession(api);

  const [editMode, setEditMode] = useInitEditMode();
  const [hoverTarget, setHoverTarget] = useHoverTarget(editMode);
  const [windowTarget, setWindowTarget] = useState<WindowTarget | null>(null);
  const [highlight, setHighlight] = useState(false);
  const { selectedSchema, selectedSource, error, loading } = useValModules(
    api,
    windowTarget?.path
  );

  const [state, setState] = useState<{
    [path: SourcePath]: () => PatchJSON;
  }>({});
  const initPatchCallback = useCallback((currentPath: SourcePath | null) => {
    return (callback: PatchCallback) => {
      // TODO: revaluate this logic when we have multiple paths
      // NOTE: see cleanup of state in useEffect below
      if (!currentPath) {
        setState({});
      } else {
        const patchPath = Internal.createPatchJSONPath(
          Internal.splitModuleIdAndModulePath(currentPath)[1]
        );
        setState((prev) => {
          return {
            ...prev,
            [currentPath]: () => callback(patchPath),
          };
        });
      }
    };
  }, []);
  useEffect(() => {
    setState((prev) => {
      return Object.fromEntries(
        Object.entries(prev).filter(([path]) => path === windowTarget?.path)
      );
    });
  }, [windowTarget?.path]);

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
      }}
    >
      <div data-mode={theme}>
        <div className="fixed -translate-x-1/2 z-overlay left-1/2 bottom-4">
          <ValMenu api={api} />
        </div>
        {editMode === "hover" && hoverTarget && (
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
            <div className="px-4 py-2 text-sm border-b border-highlight">
              <WindowHeader
                path={windowTarget.path}
                type={selectedSchema?.type}
              />
            </div>
            {loading && <div className="text-primary">Loading...</div>}
            {error && <div className="text-red">{error}</div>}
            {typeof selectedSource === "string" &&
              selectedSchema?.type === "string" && (
                <TextField
                  defaultValue={selectedSource}
                  isLoading={loading}
                  registerPatchCallback={initPatchCallback(windowTarget.path)}
                />
              )}
            {selectedSource &&
              typeof selectedSource === "object" &&
              VAL_EXTENSION in selectedSource &&
              selectedSource[VAL_EXTENSION] === "richtext" && (
                <RichTextField
                  registerPatchCallback={initPatchCallback(windowTarget.path)}
                  defaultValue={selectedSource as RichText<AnyRichTextOptions>}
                />
              )}
            {selectedSource &&
              typeof selectedSource === "object" &&
              VAL_EXTENSION in selectedSource &&
              selectedSource[VAL_EXTENSION] === "file" && (
                <ImageField
                  registerPatchCallback={initPatchCallback(windowTarget.path)}
                  defaultValue={selectedSource as ImageSource}
                />
              )}
            <div className="flex items-end justify-end py-2">
              <SubmitButton
                disabled={false}
                onClick={() => {
                  if (state[windowTarget.path]) {
                    const [moduleId] = Internal.splitModuleIdAndModulePath(
                      windowTarget.path
                    );
                    const patch = state[windowTarget.path]();
                    console.log("Submitting", patch);
                    api
                      .postPatches(moduleId, patch)
                      .then((res) => {
                        console.log(res);
                      })
                      .finally(() => {
                        console.log("done");
                      });
                  }
                }}
              />
            </div>
          </ValWindow>
        )}
      </div>
    </ValOverlayContext.Provider>
  );
}

type PatchCallback = (modulePath: string) => PatchJSON;

function ImageField({
  defaultValue,
  registerPatchCallback,
}: {
  registerPatchCallback: (callback: PatchCallback) => void;
  defaultValue?: ImageSource;
}) {
  const [data, setData] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<{
    width?: number;
    height?: number;
    sha256: string;
  } | null>(null);
  const url = defaultValue && Internal.convertFileSource(defaultValue).url;
  useEffect(() => {
    registerPatchCallback((path) => {
      const pathParts = path.split("/");
      if (!data) {
        return [];
      }
      return [
        {
          value: {
            ...defaultValue,
            metadata,
          },
          op: "replace",
          path,
        },
        // update the contents of the file:
        {
          value: data,
          op: "replace",
          path: `${pathParts.slice(0, -1).join("/")}/$${
            pathParts[pathParts.length - 1]
          }`,
        },
      ];
    });
  }, [data]);

  return (
    <div>
      <label htmlFor="img_input" className="">
        <img src={data || url} />
        <input
          id="img_input"
          type="file"
          hidden
          onChange={(ev) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => {
              const result = reader.result;
              if (typeof result === "string") {
                const image = new Image();
                image.addEventListener("load", async () => {
                  const sha256 = await Internal.getSHA256Hash(
                    textEncoder.encode(result)
                  );
                  if (image.naturalWidth && image.naturalHeight) {
                    setMetadata({
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                      sha256,
                    });
                  } else {
                    setMetadata({
                      sha256,
                    });
                  }
                  setData(result);
                });
                image.src = result;
              } else if (!result) {
                setMetadata(null);
                setData(null);
              } else {
                console.error("Unexpected image result type", result);
              }
            });
            const imageFile = ev.currentTarget.files?.[0];
            if (imageFile) {
              reader.readAsDataURL(imageFile);
            }
          }}
        />
      </label>
    </div>
  );
}

const textEncoder = new TextEncoder();

function RichTextField({
  defaultValue,
  registerPatchCallback,
}: {
  registerPatchCallback: (callback: PatchCallback) => void;
  defaultValue?: RichText<AnyRichTextOptions>;
}) {
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  useEffect(() => {
    if (editor) {
      registerPatchCallback((path) => {
        const value: RichText<AnyRichTextOptions> = editor?.toJSON()
          ?.editorState
          ? fromLexical(editor?.toJSON()?.editorState.root as LexicalRootNode)
          : {
              [VAL_EXTENSION]: "richtext",
              children: [],
            };
        return [
          {
            op: "replace",
            path,
            value: {
              ...value,
              [VAL_EXTENSION]: "richtext",
            },
          },
        ];
      });
    }
  }, [editor]);
  return (
    <RichTextEditor
      onEditor={(editor) => {
        setEditor(editor);
      }}
      richtext={
        defaultValue ||
        ({
          children: [],
          [VAL_EXTENSION]: "root",
        } as unknown as RichText<AnyRichTextOptions>)
      }
    />
  );
}

function TextField({
  isLoading,
  defaultValue,
  registerPatchCallback,
}: {
  registerPatchCallback: (callback: PatchCallback) => void;
  isLoading: boolean;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue || "");

  // ref is used to get the value of the textarea without closing over the value field
  // to avoid registering a new callback every time the value changes
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    registerPatchCallback((path) => {
      return [
        {
          op: "replace",
          path,
          value: ref.current?.value || "",
        },
      ];
    });
  }, []);

  return (
    <div className="flex flex-col justify-between h-full px-4">
      <div
        className="w-full h-full py-2 overflow-y-scroll grow-wrap"
        data-replicated-value={value} /* see grow-wrap */
      >
        <textarea
          ref={ref}
          disabled={isLoading}
          className="p-2 border outline-none resize-none bg-fill text-primary border-border focus-visible:border-highlight"
          defaultValue={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
    </div>
  );
}

function SubmitButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      className="px-4 py-2 border border-highlight disabled:border-border"
      disabled={disabled}
      onClick={onClick}
    >
      Submit
    </button>
  );
}

function useValModules(api: ValApi, path: string | undefined) {
  const [modules, setModules] = useState<Remote<Modules>>();
  const moduleId =
    path && Internal.splitModuleIdAndModulePath(path as SourcePath)[0];

  useEffect(() => {
    if (path) {
      setModules({ status: "loading" });
      api
        .getModules({
          patch: true,
          includeSchema: true,
          includeSource: true,
          treePath: moduleId,
        })
        .then((res) => {
          if (result.isOk(res)) {
            setModules({ status: "success", data: res.value.modules });
          } else {
            console.error({ status: "error", error: res.error });
            setModules({ status: "error", error: res.error.message });
          }
        });
    }
  }, [path]);
  if (!path || modules?.status === "not-asked") {
    return {
      error: null,
      selectedSource: undefined,
      selectedSchema: undefined,
      loading: false,
    };
  }
  if (modules?.status === "loading") {
    return {
      error: null,
      selectedSource: undefined,
      selectedSchema: undefined,
      loading: true,
    };
  }
  if (modules?.status === "error") {
    return {
      error: modules.error,
      selectedSource: undefined,
      selectedSchema: undefined,
      loading: false,
    };
  }
  if (!modules?.data) {
    return {
      error: "No modules",
      selectedSource: undefined,
      selectedSchema: undefined,
      loading: false,
    };
  }

  const resolvedModulePath = resolvePath(path as SourcePath, modules.data);

  const {
    error,
    source: selectedSource,
    schema: selectedSchema,
  } = resolvedModulePath && result.isOk(resolvedModulePath)
    ? {
        ...resolvedModulePath.value,
        error: null,
      }
    : {
        error:
          resolvedModulePath && result.isErr(resolvedModulePath)
            ? resolvedModulePath.error.message
            : null,
        source: undefined,
        schema: undefined,
      };
  return {
    error,
    selectedSource,
    selectedSchema,
    loading: false,
  };
}

type WindowTarget = {
  element?: HTMLElement | undefined;
  mouse: { x: number; y: number };
  path: SourcePath;
};

type HoverTarget = {
  element?: HTMLElement | undefined;
  path: SourcePath;
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
      className="fixed border-2 cursor-pointer z-overlay-hover border-base"
      style={{
        top: rect?.top,
        left: rect?.left,
        width: rect?.width,
        height: rect?.height,
      }}
      onClick={(ev) => {
        setWindowTarget({
          ...hoverTarget,
          mouse: { x: ev.pageX, y: ev.pageY },
        });
        setEditMode("window");
        setHoverTarget(null);
      }}
    >
      <div className="flex items-center justify-end w-full text-xs">
        <div
          className="flex items-center justify-center px-3 py-1 text-primary bg-base"
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

function useHoverTarget(editMode: EditMode) {
  const [target, setTarget] = useState<{
    element?: HTMLElement;
    rect?: DOMRect;
    path: SourcePath;
  } | null>(null);
  useEffect(() => {
    if (editMode === "hover") {
      let curr: HTMLElement | null = null;
      const mouseOverListener = (e: MouseEvent) => {
        const target = e.target as HTMLElement | null;
        curr = target;
        // TODO: use .contains?
        do {
          if (curr?.dataset.valPath) {
            setTarget({
              element: curr,
              path: curr.dataset.valPath as SourcePath,
            });
            break;
          }
        } while ((curr = curr?.parentElement || null));
      };
      const scrollListener = () => {
        if (target?.element) {
          setTarget({
            ...target,
          });
        }
      };

      document.addEventListener("mouseover", mouseOverListener);
      document.addEventListener("scroll", scrollListener, { passive: true });

      return () => {
        setTarget(null);
        document.removeEventListener("mouseover", mouseOverListener);
        document.removeEventListener("scroll", scrollListener);
      };
    }
  }, [editMode]);

  return [target, setTarget] as const;
}

function useTheme(defaultTheme: Theme = "dark") {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    if (localStorage.getItem("val-theme") === "light") {
      setTheme("light");
    } else if (localStorage.getItem("val-theme") === "dark") {
      setTheme("dark");
    } else if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      setTheme("dark");
    } else if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      setTheme("light");
    }
    const themeListener = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem("val-theme")) {
        setTheme(e.matches ? "dark" : "light");
      }
    };
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", themeListener);
    return () => {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .removeEventListener("change", themeListener);
    };
  }, []);

  return [
    theme,
    (theme: Theme) => {
      localStorage.setItem("val-theme", theme);
      setTheme(theme);
    },
  ] as const;
}

function useSession(api: ValApi) {
  const [session, setSession] = useState<Remote<Session>>({
    status: "not-asked",
  });
  const [sessionResetId, setSessionResetId] = useState(0);
  useEffect(() => {
    setSession({ status: "loading" });
    api.getSession().then(async (res) => {
      try {
        if (result.isOk(res)) {
          const session = res.value;
          setSession({ status: "success", data: Session.parse(session) });
        } else {
          if (sessionResetId < 3) {
            setTimeout(() => {
              setSessionResetId(sessionResetId + 1);
            }, 200 * sessionResetId);
          } else {
            setSession({ status: "error", error: "Could not fetch session" });
          }
        }
      } catch (e) {
        setSession({
          status: "error",
          error: "Got an error while trying to get session",
        });
      }
    });
  }, [sessionResetId]);
  return session;
}

function WindowHeader({
  path,
  type,
}: {
  path: SourcePath;
  type?: SerializedSchema["type"];
}) {
  const segments = path.split("/").slice(1);
  return (
    <span className="flex items-center justify-between">
      <span>
        <span className="pr-1 text-xs opacity-50">/</span>
        {segments.map((segment, i) => {
          if (i === segments.length - 1) {
            return (
              <span key={i} className="text-primary">
                {segment.split(".").map((s, i) => {
                  let name = s;
                  if (i === 0) {
                    return (
                      <span key={i + "."}>
                        <span>{name}</span>
                      </span>
                    );
                  } else {
                    name = JSON.parse(s);
                  }
                  return (
                    <span key={i + "."}>
                      <span className="px-1 text-xs text-highlight">/</span>
                      <span>{name}</span>
                    </span>
                  );
                })}
              </span>
            );
          }
          return (
            <span key={i}>
              <span>{segment}</span>
              <span className="px-1 text-xs opacity-50">/</span>
            </span>
          );
        })}
      </span>
      {type && <span className="ml-4">({type})</span>}
    </span>
  );
}
