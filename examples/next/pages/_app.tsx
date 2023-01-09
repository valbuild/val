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

const getValModuleId = (id: string) => {
  return id.split(".")[0];
};

const getPathFromModuleId = (id: string) => {
  return id.split(".").slice(1);
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

const fetchValContent = async (id: string): Promise<SerializedVal> => {
  const res = await fetch(`http://localhost:4123/ids/${getValModuleId(id)}`);
  if (res.ok) {
    const serializedVal = await res.json();
    return serializedVal;
  } else {
    throw Error(
      `Failed to fetch val content for id: ${id}. Error: ${await res.text()}`
    );
  }
};

const ValEditForm: React.FC<{
  position: FormPosition | null;
  selectedIds: string[];
}> = ({ position, selectedIds }) => {
  const [resolvedIds, setResolvedIds] = useState<
    (
      | { id: string; status: "not-asked" }
      | { id: string; status: "error"; error: string }
      | { id: string; status: "ready"; data: ValidTypes }
    )[]
  >([]);
  useEffect(() => {
    setResolvedIds(selectedIds.map((id) => ({ id, status: "not-asked" })));
    Promise.all(
      selectedIds.map(async (id) => {
        try {
          const serializedVal = await fetchValContent(id);
          const val = getValFromModule(
            getPathFromModuleId(id),
            serializedVal.val
          );
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
      setResolvedIds(resolvedIds);
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
    >
      {resolvedIds === null
        ? "Loading..."
        : resolvedIds.map((resolvedId) => (
            <label key={resolvedId.id}>
              {resolvedId.id}
              {resolvedId.status === "not-asked" ? (
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
