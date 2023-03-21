import { Source, ModuleContent } from "@valbuild/lib";
import * as expr from "@valbuild/lib/expr";
import { formatJSONPointer, parseJSONPointer } from "@valbuild/lib/patch";
import { result } from "@valbuild/lib/fp";
import React, {
  CSSProperties,
  forwardRef,
  MouseEventHandler,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { editIcon, valcmsLogo } from "./assets";
import { ValApi } from "./ValApi";
import { ValStore } from "./ValStore";

const baseZIndex = 8500; // Next uses 9000 highest z-index so keep us below that

export function useValStore() {
  return useContext(ValContext).valStore;
}
export function useValApi() {
  return useContext(ValContext).valApi;
}

// TODO: Use me!
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ValElementEditButton = forwardRef<
  HTMLButtonElement,
  {
    left?: CSSProperties["left"];
    top?: CSSProperties["top"];
    display?: CSSProperties["display"];
    onClick: MouseEventHandler<HTMLButtonElement>;
  }
>(function ValEditButton({ left, top: top, display, onClick }, ref) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      style={{
        display,
        left,
        top,
        position: "absolute",
        zIndex: baseZIndex + 1,
        cursor: "pointer",
        background: `url('${valcmsLogo}')`,
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundColor: "white",
        width: "20px",
        height: "20px",
        border: "none",
      }}
    />
  );
});

// TODO: Use me!
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ValSidebar = ({
  selectedIds,
  onClose,
}: {
  selectedIds: string[];
  onClose: () => void;
}) => {
  if (selectedIds.length === 0) {
    return null;
  }
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        height: "100vh",
        width: "300px",
        background: "whitesmoke",
        zIndex: baseZIndex + 1,
      }}
    >
      <button
        style={{ position: "absolute", right: 0, top: 0 }}
        onClick={onClose}
      >
        Close
      </button>
      <h1>ValCMS</h1>
      <form>
        {selectedIds.map((id) => (
          <label key={id}>
            {id}
            <input defaultValue={"TODO"}></input>
          </label>
        ))}
        <input type="submit" value="Save" />
      </form>
    </div>
  );
};

const ValEditEnableButton = ({
  enabled,
  setEnabled,
}: {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}) => {
  return (
    <button
      data-val-element="true"
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        position: "fixed",
        zIndex: baseZIndex + 1,
        cursor: "pointer",
        left: "10px",
        bottom: "10px",
        color: "white",
        backgroundColor: "black",
        height: "50px",
        width: "10rem",
        border: "1px solid white",
      }}
      onClick={() => {
        setEnabled(!enabled);
      }}
    >
      <span
        style={{
          background: `url('${editIcon(18, "white")}')`,
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          appearance: "none",
          cursor: "pointer",
          height: "18px",
          width: "18px",
          border: "none",
        }}
      ></span>
      <span
        style={{
          marginLeft: "8px",
          fontSize: "16px",
        }}
      >
        EDIT
      </span>
    </button>
  );
};

type FormPosition = {
  left: number;
  top: number;
};

type Operation = {
  op: "replace";
  path: string;
  value: Source;
};

const ValFontFamily = "Arial, Verdana, Tahoma, Cantarell, sans-serif";

const ValEditForm: React.FC<{
  host: string;
  position: FormPosition | null;
  selectedSources: string[];
  onClose: () => void;
}> = ({ host, position, selectedSources, onClose }) => {
  type Entry =
    | {
        source: string;
        status: "loading";
      }
    | {
        source: string;
        status: "error";
        error: string;
      }
    | {
        source: string;
        status: "ready";
        moduleId: string;
        locale: "en_US";
        value: string;
        path: string;
      };
  const [entries, setEntries] = useState<Entry[]>([]);
  const valStore = useValStore();
  const valApi = useValApi();

  const [submission, setSubmission] = useState<
    | { status: "submitting" }
    | { status: "error"; error: string }
    | { status: "ready" }
  >({ status: "ready" });

  useEffect(() => {
    setEntries(
      selectedSources.map((source) => ({ source, status: "loading" }))
    );

    Promise.all(
      selectedSources.map(async (source): Promise<Entry> => {
        try {
          const [moduleId, locale, sourceExpr] =
            expr.strings.parseValSrc(source);
          const mod = ModuleContent.deserialize(
            await valApi.getModule(moduleId)
          );
          valStore.set(moduleId, mod);

          const [value, ref] = (
            sourceExpr as expr.Expr<readonly [Source], Source>
          ).evaluateRef([mod.schema.localize(mod.source, locale)], [""]);
          if (!expr.isAssignable(ref)) {
            return {
              source,
              status: "error",
              error: "ref is not singular",
            };
          }
          if (typeof value !== "string") {
            return {
              source,
              status: "error",
              error: "value is not a string",
            };
          }
          return {
            source,
            status: "ready",
            moduleId,
            locale,
            value,
            path: ref,
          };
        } catch (err) {
          console.error(err);
          return {
            source,
            status: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      })
    ).then((resolvedEntries) => {
      setEntries(resolvedEntries);
    });
  }, [host, selectedSources.join(",")]);

  if (!position) {
    return null;
  }
  return (
    <form
      data-val-element={true}
      style={{
        position: "absolute",
        left: position.left,
        top: position.top,
        zIndex: 999999,
        minWidth: "300px",
        background: "black",
        color: "white",
        padding: "10px",
        border: "1px solid white",
        fontFamily: ValFontFamily,
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        setSubmission({ status: "submitting" });
        try {
          const data = new FormData(e.currentTarget);
          const modulePatches: Record<string, Operation[]> = {};
          for (const entry of entries) {
            if (entry.status === "ready") {
              const { moduleId, locale } = entry;
              let { path } = entry;
              if (!modulePatches[moduleId]) {
                modulePatches[moduleId] = [];
              }
              const value = data.get(path);
              if (typeof value !== "string") {
                throw Error("Invalid non-string value in form");
              }
              const mod = valStore.get(moduleId);
              if (!mod) {
                throw Error(`${moduleId} is not in store`);
              }
              const parsedPath = parseJSONPointer(path);
              if (result.isErr(parsedPath)) {
                throw Error(`${JSON.stringify(path)} is invalid JSON pointer`);
              }
              path = formatJSONPointer(
                mod.schema.delocalizePath(mod.source, parsedPath.value, locale)
              );
              modulePatches[moduleId].push({
                op: "replace",
                path,
                value,
              });
            }
          }
          await Promise.all(
            Object.entries(modulePatches).map(async ([moduleId, patch]) => {
              const moduleContent = ModuleContent.deserialize(
                await valApi.patchModuleContent(moduleId, patch)
              );
              valStore.set(moduleId, moduleContent);
            })
          );
          setSubmission({
            status: "ready",
          });
          onClose();
        } catch (err) {
          setSubmission({
            status: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        }
      }}
    >
      {submission.status === "error" && submission.error}
      {entries === null
        ? "Loading..."
        : entries.map((entry) => (
            <label key={entry.source}>
              {entry.status === "loading" ? (
                "Loading..."
              ) : entry.status === "error" ? (
                entry.error
              ) : (
                <>
                  {entry.moduleId}?{entry.locale}?{entry.path}
                  <textarea
                    style={{
                      display: "block",
                      width: "100%",
                      background: "black",
                      color: "white",
                      minHeight: "200px",
                    }}
                    name={entry.path}
                    defaultValue={entry.value}
                  />
                </>
              )}
            </label>
          ))}
      <input type="submit" value="Save" />
    </form>
  );
};

export type ValContext = {
  readonly valStore: ValStore;
  readonly valApi: ValApi;
};

export const ValContext = React.createContext<ValContext>({
  get valStore(): never {
    throw Error(
      "Val context not found. Ensure components are wrapped by ValProvider!"
    );
  },
  get valApi(): never {
    throw Error(
      "Val context not found. Ensure components are wrapped by ValProvider!"
    );
  },
});

export type ValProviderProps = {
  host?: string;
  children?: React.ReactNode;
};

type AuthStatus =
  | {
      status:
        | "not-asked"
        | "authenticated"
        | "unauthenticated"
        | "loading"
        | "local";
    }
  | {
      status: "error";
      message: string;
    };

function isValElement(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  if (el.getAttribute("data-val-element") === "true") {
    return true;
  }
  return isValElement(el.parentElement);
}

export function ValProvider({ host = "/api/val", children }: ValProviderProps) {
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [editFormPosition, setEditFormPosition] = useState<FormPosition | null>(
    null
  );
  const [authentication, setAuthentication] = useState<AuthStatus>({
    status: "not-asked",
  });
  const valApi = useMemo(() => new ValApi(host), [host]);
  const valStore = useMemo(() => new ValStore(valApi), [valApi]);

  useEffect(() => {
    if (enabled) {
      valStore.updateAll();
    }
  }, [enabled]);
  useEffect(() => {
    let openValFormListener: ((e: MouseEvent) => void) | undefined = undefined;
    let styleElement: HTMLStyleElement | undefined = undefined;
    const editButtonClickOptions = {
      capture: true,
      passive: true,
    };
    if (enabled) {
      // highlight val element by appending a new style
      styleElement = document.createElement("style");
      styleElement.id = "val-edit-highlight";
      styleElement.innerHTML = `
        .val-edit-mode >* [data-val-src] {
          outline: black solid 2px;
          outline-offset: 4px;
          cursor: pointer;
        }
      `;
      document.body.appendChild(styleElement);

      // capture event clicks on data-val-src elements
      openValFormListener = (e: MouseEvent) => {
        if (e.target instanceof Element) {
          const valSources = e.target?.getAttribute("data-val-src");
          if (valSources) {
            e.stopPropagation();
            setSelectedSources(expr.strings.split(valSources, ","));
            setEditFormPosition({
              left: e.clientX,
              top: e.clientY,
            });
          } else if (!isValElement(e.target)) {
            setEditFormPosition(null);
            setSelectedSources([]);
          }
        }
      };
      document.addEventListener(
        "click",
        openValFormListener,
        editButtonClickOptions
      );
    }
    return () => {
      if (openValFormListener) {
        document.removeEventListener(
          "click",
          openValFormListener,
          editButtonClickOptions
        );
      }
      styleElement?.remove();
    };
  }, [enabled]);

  useEffect(() => {
    const requestAuth = !(
      authentication.status === "authenticated" ||
      authentication.status === "local"
    );
    if (requestAuth) {
      setSelectedSources([]);
      setEditFormPosition(null);
    }
    if (!enabled) {
      // reset state when disabled
      setSelectedSources([]);
      setEditFormPosition(null);
    }
  }, [enabled, selectedSources.length, authentication.status]);

  useEffect(() => {
    if (enabled) {
      document.body.classList.add("val-edit-mode");
    } else {
      document.body.classList.remove("val-edit-mode");
    }

    if (enabled) {
      if (authentication.status !== "authenticated") {
        valApi
          .getSession()
          .then(async (res) => {
            if (res.status === 401) {
              setAuthentication({
                status: "unauthenticated",
              });
            } else if (res.ok) {
              const data = await res.json();
              if (data.mode === "local") {
                setAuthentication({ status: "local" });
              } else if (data.mode === "proxy") {
                setAuthentication({
                  status: "authenticated",
                });
              } else {
                setAuthentication({
                  status: "error",
                  message: "Unknown authentication mode",
                });
              }
            } else {
              let message = "Unknown error";
              try {
                message = await res.text();
              } catch {
                // ignore
              }
              setAuthentication({
                status: "error",
                message,
              });
            }
          })
          .catch((err) => {
            console.error("Failed to fetch session", err);
            setAuthentication({
              status: "error",
              message: "Unknown authentication mode",
            });
          });
      }
    } else {
      if (authentication.status === "error") {
        setAuthentication({
          status: "not-asked",
        });
      }
    }
  }, [enabled, authentication.status]);

  return (
    <ValContext.Provider
      value={{
        valApi,
        valStore,
      }}
    >
      {children}
      {authentication.status === "local" && enabled && (
        <ValEditForm
          host={host}
          selectedSources={selectedSources}
          position={editFormPosition}
          onClose={() => {
            setEditFormPosition(null);
            setSelectedSources([]);
          }}
        />
      )}
      {authentication.status === "authenticated" && (
        <>
          {enabled && <ValProxyActions setAuthentication={setAuthentication} />}
          <ValEditForm
            host={host}
            selectedSources={selectedSources}
            position={editFormPosition}
            onClose={() => {
              setEditFormPosition(null);
              setSelectedSources([]);
            }}
          />
        </>
      )}
      {enabled && authentication.status === "unauthenticated" && (
        <ValLoginPrompt />
      )}
      {authentication.status === "error" && (
        <div
          style={{
            position: "absolute",
            height: "100vh",
            width: "100vw",
            background: "red",
            zIndex: baseZIndex,
            top: 0,
            left: 0,
          }}
        >
          Error: {authentication.message}
        </div>
      )}
      <ValEditEnableButton enabled={enabled} setEnabled={setEnabled} />
    </ValContext.Provider>
  );
}

function Menu({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-val-element="true"
      style={{
        position: "fixed",
        minHeight: "2em",
        width: "10rem",
        background: "transparent",
        zIndex: baseZIndex,
        bottom: 68,
        left: 10,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid white",
      }}
    >
      {children}
    </div>
  );
}

function ValProxyActions({
  setAuthentication,
}: {
  setAuthentication: (auth: AuthStatus) => void;
}) {
  const valApi = useValApi();
  return (
    <Menu>
      <button
        style={{
          display: "block",
          color: "white",
          background: "black",
          border: "none",
          cursor: "pointer",
          width: "100%",
          fontFamily: ValFontFamily,
          fontWeight: "normal",
          fontSize: "16px",
          marginBottom: "1em",
          padding: "8px 16px",
        }}
        onClick={() => {
          valApi.commit();
        }}
      >
        Commit
      </button>
      <button
        style={{
          display: "block",
          color: "white",
          background: "black",
          border: "none",
          cursor: "pointer",
          width: "100%",
          fontFamily: ValFontFamily,
          fontWeight: "normal",
          fontSize: "16px",
          padding: "8px 16px",
        }}
        onClick={() => {
          valApi.logout().then((res) => {
            if (res.ok) {
              setAuthentication({
                status: "unauthenticated",
              });
            } else {
              console.error("Could not log out", res.status);
            }
          });
        }}
      >
        Log out
      </button>
    </Menu>
  );
}

function ValLoginPrompt() {
  const valApi = useValApi();
  return (
    <Menu>
      <a
        style={{
          background: "black",
          color: "white",
          fontFamily: ValFontFamily,
          fontWeight: "normal",
          fontSize: "16px",
        }}
        href={valApi.loginUrl()}
      >
        Login
      </a>
    </Menu>
  );
}
