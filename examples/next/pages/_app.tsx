import { SerializedVal } from "@val/lib/src/StaticVal";
import {
  ValidObject,
  ValidPrimitive,
  ValidTypes,
} from "@val/lib/src/ValidTypes";
import type { AppProps } from "next/app";
import React, {
  CSSProperties,
  forwardRef,
  MouseEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";

const API_URL = "http://localhost:4123";

const baseZIndex = 8500; // Next uses 9000 highest z-index so keep us below that

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
        background: "url('/valcms-logo.svg')",
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
      style={{
        background: 'url("/logo.svg")',
        backgroundSize: "contain",
        backgroundRepeat: "no-repeat",
        backgroundColor: "black",
        border: "none",
        position: "fixed",
        zIndex: baseZIndex + 1,
        height: "50px",
        width: "50px",
        cursor: "pointer",
        borderRadius: "100%",
        left: "10px",
        bottom: "10px",
      }}
      onClick={() => {
        if (!enabled) {
          document.body.classList.add("valcms-edit-mode");
        } else {
          document.body.classList.remove("valcms-edit-mode");
        }
        setEnabled(!enabled);
      }}
    ></button>
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
          module
        )}`
      );
    }
  }
  return val;
};

const getModuleContent = async (moduleId: string): Promise<SerializedVal> => {
  const res = await fetch(`${API_URL}/ids${moduleId}`);
  if (res.ok) {
    const serializedVal = await res.json();
    return serializedVal;
  } else {
    throw Error(
      `Failed to get content of module "${moduleId}". Error: ${await res.text()}`
    );
  }
};

type Operation = {
  op: "replace";
  path: string;
  value: ValidTypes;
};

const patchModuleContent = async (
  moduleId: string,
  patch: Operation[]
): Promise<void> => {
  const res = await fetch(`${API_URL}/ids${moduleId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json-patch+json",
    },
    body: JSON.stringify(patch),
  });
  if (res.ok) {
    return;
  } else {
    throw Error(
      `Failed to patch content of module "${moduleId}". Error: ${await res.text()}`
    );
  }
};

const ValEditForm: React.FC<{
  position: FormPosition | null;
  selectedIds: string[];
}> = ({ position, selectedIds }) => {
  const [entries, setEntries] = useState<
    (
      | { id: string; status: "loading" }
      | { id: string; status: "error"; error: string }
      | { id: string; status: "ready"; data: ValidTypes }
    )[]
  >([]);

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
          const serializedVal = await getModuleContent(moduleId);
          const val = getValFromModule(path, serializedVal.val);
          return {
            id,
            status: "ready",
            data: val,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(",")]);

  if (!position) {
    return null;
  }
  return (
    <form
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
              await patchModuleContent(moduleId, patch);
            })
          );
          setSubmission({
            status: "ready",
          });
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
                  defaultValue={resolvedId.data as ValidPrimitive}
                ></textarea>
              )}
            </label>
          ))}
      <input type="submit" value="Save" />
    </form>
  );
};

const ValContext = React.createContext<{}>({});

function Val({ children }: { children: React.ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [editFormPosition, setEditFormPosition] = useState<FormPosition | null>(
    null
  );

  useEffect(() => {
    if (!enabled) {
      setSelectedIds([]);
      setEditFormPosition(null);
    }
    // capture event clicks on data-val-ids elements
    const editButtonClickListener = (e: MouseEvent) => {
      if (enabled) {
        if (e.target instanceof Element) {
          const valId = e.target?.getAttribute("data-val-ids");
          if (valId) {
            e.stopPropagation();
            setSelectedIds(valId.split(","));
            const rect = e.target.getBoundingClientRect();
            setEditFormPosition({
              left: rect.right,
              top: rect.top - 1 /* outline */,
            });
          }
        }
      }
    };

    // create style element on body
    document.getElementById("val-edit-highlight")?.remove();
    const styleElement = document.createElement("style");
    styleElement.id = "val-edit-highlight";
    styleElement.innerHTML = `
        .valcms-edit-mode >* [data-val-ids] {
          outline: black solid 1px;
        }
        .valcms-edit-mode >* [data-val-ids]:before {
          content: '';
          background: url('/logo.svg');
          background-size: 20px;
          background-repeat: no-repeat;
          background-position: top;
          padding: 4px;
          cursor: pointer;
          height: 20px;
          width: 20px;
          position: absolute;
        }
      `;
    document.body.appendChild(styleElement);

    //
    const editButtonClickOptions = {
      capture: true,
      passive: true,
    };
    document.addEventListener(
      "click",
      editButtonClickListener,
      editButtonClickOptions
    );
    return () => {
      document.removeEventListener(
        "click",
        editButtonClickListener,
        editButtonClickOptions
      );
    };
  }, [enabled, selectedIds.length]);
  return (
    <ValContext.Provider value={{}}>
      {children}
      <ValEditForm selectedIds={selectedIds} position={editFormPosition} />
      <ValEditEnableButton enabled={enabled} setEnabled={setEnabled} />
    </ValContext.Provider>
  );
}

function MyApp({ Component, pageProps }: AppProps) {
  return (
    <Val>
      <Component {...pageProps} />
    </Val>
  );
}

export default MyApp;
