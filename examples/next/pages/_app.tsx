import type { AppProps } from "next/app";
import {
  CSSProperties,
  forwardRef,
  MouseEventHandler,
  useEffect,
  useRef,
  useState,
} from "react";

const ValEditButton = forwardRef<
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

function MyApp({ Component, pageProps }: AppProps) {
  const buttonElementRef = useRef<HTMLButtonElement>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [currentIds, setCurrentIds] = useState<string[]>([]);
  const [editButtonProps, setEditButtonProps] = useState<{
    left?: CSSProperties["left"];
    top?: CSSProperties["top"];
    display?: CSSProperties["display"];
  }>({ left: 0, top: "auto", display: "none" });
  useEffect(() => {
    let timeout: NodeJS.Timeout;

    const listener = (e: MouseEvent) => {
      const currentElement = document.elementFromPoint(e.clientX, e.clientY);
      const valId = currentElement?.getAttribute("data-val-ids");
      if (currentElement) {
        if (valId) {
          setCurrentIds(valId.split(","));
          clearTimeout(timeout);
          const rect = currentElement.getBoundingClientRect();
          setEditButtonProps({
            display: "block",
            left: rect.left + "px",
            top: rect.top + "px",
          });
        } else if (currentElement === buttonElementRef.current) {
          clearTimeout(timeout);
        } else {
          timeout = setTimeout(() => {
            setEditButtonProps({ display: "none" });
          }, 1000);
        }
      }
    };
    document.addEventListener("mousemove", listener, { passive: true });
    return () => {
      document.removeEventListener("mousemove", listener);
      clearTimeout(timeout);
    };
  }, []);
  return (
    <div>
      <Component {...pageProps} />
      <ValEditButton
        ref={buttonElementRef}
        {...editButtonProps}
        onClick={() => {
          setSelectedIds(currentIds);
        }}
      />
      <ValSidebar
        selectedIds={selectedIds}
        onClose={() => {
          setSelectedIds([]);
        }}
      />
    </div>
  );
}

export default MyApp;
