import type { AppProps } from "next/app";
import React, {
  CSSProperties,
  forwardRef,
  MouseEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";

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
        zIndex: 999998,
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
        zIndex: 999999,
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
        zIndex: 999999,
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

const ValEditForm: React.FC<{ selectedIds: string[] }> = ({ selectedIds }) => {
  const [position, setPosition] = useState<
    { left: number; top: number } | undefined
  >();
  useEffect(() => {
    if (selectedIds.length > 0) {
      if (
        document.querySelectorAll(`[data-val-ids='${selectedIds.join(",")}']`)
      ) {
        const element = document.querySelector(
          `[data-val-ids='${selectedIds.join(",")}']`
        );
        if (element) {
          const rect = element.getBoundingClientRect();
          setPosition({
            left: rect.left + rect.width + window.scrollX,
            top: rect.top,
          });
        }
      }
    }
  }, [selectedIds]);
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
        background: "white",
        padding: "10px",
        border: "1px solid black",
      }}
    >
      <input type="text"></input>
    </form>
  );
};

const ValContext = React.createContext<{}>({});

function Val({ children }: { children: React.ReactNode }) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    // capture event clicks on data-val-ids elements
    const editButtonClickListener = (e: MouseEvent) => {
      if (enabled && selectedIds.length === 0) {
        if (e.target instanceof Element) {
          const valId = e.target?.getAttribute("data-val-ids");
          if (valId) {
            e.stopPropagation();
            setSelectedIds(valId.split(","));
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
      <ValEditForm selectedIds={selectedIds} />
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
