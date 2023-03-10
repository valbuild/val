import { ValidObject, ValidPrimitive, ValidTypes } from "@valbuild/lib";
import { applyPatch } from "fast-json-patch";
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

const parseValPath = (path: string): [moduleId: string, path: string[]] => {
  const [moduleId, ...pathInModule] = path.split(".");
  return [moduleId, pathInModule];
};

const getValFromModule = (paths: string[], valContent: ValidTypes) => {
  let val: ValidTypes = valContent;
  for (const path of paths) {
    if (typeof val === "object" && val) {
      val = (val as ValidObject)[path];
    } else {
      throw Error(
        `Cannot descend into non-object. Path: ${path}. Content: ${JSON.stringify(
          valContent
        )}`
      );
    }
  }
  return val;
};

type Operation = {
  op: "replace";
  path: string;
  value: ValidTypes;
};

const ValFontFamily = "Arial, Verdana, Tahoma, Cantarell, sans-serif";

const ValEditForm: React.FC<{
  host: string;
  position: FormPosition | null;
  selectedIds: string[];
  onClose: () => void;
}> = ({ host, position, selectedIds, onClose }) => {
  const [entries, setEntries] = useState<
    (
      | { id: string; status: "loading" }
      | { id: string; status: "error"; error: string }
      | { id: string; status: "ready"; data: ValidTypes; path: string[] }
    )[]
  >([]);
  const valStore = useValStore();
  const valApi = useValApi();

  const [submission, setSubmission] = useState<
    | { status: "submitting" }
    | { status: "error"; error: string }
    | { status: "ready" }
  >({ status: "ready" });

  useEffect(() => {
    setEntries(selectedIds.map((id) => ({ id, status: "loading" })));

    Promise.all(
      selectedIds.map(async (id) => {
        try {
          const [moduleId, path] = parseValPath(id);
          const serializedVal = await valApi.getModule(moduleId);
          valStore.set(moduleId, serializedVal);
          valStore.emitChange();
          return {
            id,
            status: "ready",
            data: serializedVal.val,
            path,
          } as const;
        } catch (err) {
          return {
            id,
            status: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          } as const;
        }
      })
    ).then((resolvedIds) => {
      setEntries(resolvedIds);
    });
  }, [host, selectedIds.join(",")]);

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
              const [moduleId, path] = parseValPath(entry.id);
              if (!modulePatches[moduleId]) {
                modulePatches[moduleId] = [];
              }
              const value = data.get(entry.id);
              if (typeof value !== "string") {
                throw Error("Invalid non-string value in form");
              }
              modulePatches[moduleId].push({
                op: "replace",
                path: "/" + path.join("/"),
                value,
              });
            }
          }
          await Promise.all(
            Object.entries(modulePatches).map(async ([moduleId, patch]) => {
              await valApi.patchModuleContent(moduleId, patch);
              const currentVal = valStore.get(moduleId);
              if (!currentVal) {
                throw Error(`No val for module ${moduleId}`);
              }
              valStore.set(moduleId, {
                ...currentVal,
                val: applyPatch(currentVal.val, patch, true, false).newDocument,
              });
            })
          );
          valStore.emitChange();
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
        : entries.map((resolvedId) => (
            <label key={resolvedId.id}>
              {resolvedId.id}
              {resolvedId.status === "loading" ? (
                "Loading..."
              ) : resolvedId.status === "error" ? (
                resolvedId.error
              ) : (
                <textarea
                  style={{
                    display: "block",
                    width: "100%",
                    background: "black",
                    color: "white",
                    minHeight: "200px",
                  }}
                  name={resolvedId.id}
                  defaultValue={
                    getValFromModule(
                      resolvedId.path,
                      resolvedId.data
                    ) as ValidPrimitive
                  }
                ></textarea>
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
        .val-edit-mode >* [data-val-ids] {
          outline: black solid 2px;
          outline-offset: 4px;
          cursor: pointer;
        }
      `;
      document.body.appendChild(styleElement);

      // capture event clicks on data-val-ids elements
      openValFormListener = (e: MouseEvent) => {
        if (e.target instanceof Element) {
          const valId = e.target?.getAttribute("data-val-ids");
          if (valId) {
            e.stopPropagation();
            setSelectedIds(valId.split(","));
            setEditFormPosition({
              left: e.clientX,
              top: e.clientY,
            });
          } else if (!isValElement(e.target)) {
            setEditFormPosition(null);
            setSelectedIds([]);
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
      setSelectedIds([]);
      setEditFormPosition(null);
    }
    if (!enabled) {
      // reset state when disabled
      setSelectedIds([]);
      setEditFormPosition(null);
    }
  }, [enabled, selectedIds.length, authentication.status]);

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
          selectedIds={selectedIds}
          position={editFormPosition}
          onClose={() => {
            setEditFormPosition(null);
            setSelectedIds([]);
          }}
        />
      )}
      {authentication.status === "authenticated" && (
        <>
          {enabled && <ValLogout setAuthentication={setAuthentication} />}
          <ValEditForm
            host={host}
            selectedIds={selectedIds}
            position={editFormPosition}
            onClose={() => {
              setEditFormPosition(null);
              setSelectedIds([]);
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
        background: "black",
        color: "white",
        zIndex: baseZIndex,
        bottom: 68,
        left: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid white",
      }}
    >
      {children}
    </div>
  );
}

function ValLogout({
  setAuthentication,
}: {
  setAuthentication: (auth: AuthStatus) => void;
}) {
  const valApi = useValApi();
  return (
    <Menu>
      <button
        style={{
          color: "white",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          width: "100%",
          fontFamily: ValFontFamily,
          fontWeight: "normal",
          fontSize: "16px",
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
