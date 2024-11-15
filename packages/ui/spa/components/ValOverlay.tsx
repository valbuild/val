import classNames from "classnames";
import {
  Clock,
  Edit,
  EyeOff,
  LogIn,
  PanelsTopLeft,
  Search,
  SquareDashedMousePointer,
  Upload,
  X,
} from "lucide-react";
import {
  Dispatch,
  Fragment,
  SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnimateHeight } from "./AnimateHeight";
import { Internal, SourcePath } from "@valbuild/core";
import { CompressedPath } from "./CompressedPath";
import { Button } from "./designSystem/button";
import { AnyField } from "./AnyField";
import {
  useAuthenticationState,
  usePublish,
  useSchemaAtPath,
  useTheme,
  useValConfig,
} from "./ValProvider";
import { FieldLoading } from "./FieldLoading";
import { urlOf } from "@valbuild/shared/internal";
import { PublishErrorDialog } from "./PublishErrorDialog";

export type ValOverlayProps = {
  draftMode: boolean;
  draftModeLoading: boolean;
  setDraftMode: (draftMode: boolean) => void;
  disableOverlay: () => void;
};

type ValMenuProps = ValOverlayProps & {
  setMode: Dispatch<SetStateAction<OverlayModes>>;
  mode: OverlayModes;
  loading: boolean;
};
type DropZones =
  | "val-menu-left-top"
  | "val-menu-left-center"
  | "val-menu-left-bottom"
  | "val-menu-center-top"
  | "val-menu-center-bottom"
  | "val-menu-right-top"
  | "val-menu-right-center"
  | "val-menu-right-bottom";

type OverlayModes = "select" | null;
type EditMode = {
  joinedPaths: string;
  clientY: number;
  clientX: number;
  boundingBox: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
};
export function ValOverlay(props: ValOverlayProps) {
  const [mode, setMode] = useState<OverlayModes>(null);
  const [boundingBoxes, setBoundingBoxes] = useState<
    {
      top: number;
      left: number;
      width: number;
      height: number;
      joinedPaths: string;
    }[]
  >([]);
  const [scrollPos, setScrollPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const scrollListener = () => {
      setScrollPos({ x: window.scrollX, y: window.scrollY });
    };
    window.addEventListener("scroll", scrollListener, { passive: false });
    return () => {
      window.removeEventListener("scroll", scrollListener);
    };
  }, []);
  useEffect(() => {
    if (mode === "select") {
      let timeout: NodeJS.Timeout;
      const updateElements = () => {
        const newBoundingBoxes: {
          top: number;
          left: number;
          width: number;
          height: number;
          joinedPaths: string;
        }[] = [];
        document.querySelectorAll("[data-val-path]").forEach((el) => {
          const path = el.getAttribute("data-val-path");
          if (!path) {
            return;
          }
          const rect = el.getBoundingClientRect();
          newBoundingBoxes.push({
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            joinedPaths: path,
          });
        });
        setBoundingBoxes(newBoundingBoxes);
        timeout = setTimeout(updateElements, 1000);
      };
      updateElements();
      return () => {
        clearTimeout(timeout);
      };
    } else {
      setBoundingBoxes([]);
    }
  }, [mode, scrollPos]);
  const [editMode, setEditMode] = useState<EditMode | null>(null);
  useEffect(() => {
    if (mode === "select" && editMode === null) {
      const keyDownListener = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          setMode(null);
        }
      };
      window.addEventListener("keydown", keyDownListener);
      return () => {
        window.removeEventListener("keydown", keyDownListener);
      };
    }
  }, [mode, editMode]);

  const theme = useTheme();
  return (
    <div {...(theme ? { "data-mode": theme } : {})} id="val-overlay-container">
      {editMode !== null && (
        <Window
          editMode={editMode}
          setMode={setMode}
          setEditMode={setEditMode}
        />
      )}
      {boundingBoxes.map((boundingBox, i) => {
        return (
          <div
            className="absolute top-0 border border-bg-primary hover:border-2 z-[8998]"
            onClickCapture={(ev) => {
              ev.stopPropagation();
              setMode(null);
              setEditMode({
                joinedPaths: boundingBox.joinedPaths,
                clientY: ev.clientY,
                clientX: ev.clientX,
                boundingBox: boundingBox,
              });
            }}
            key={i}
            style={{
              display: "block",
              top: boundingBox?.top + scrollPos.y,
              left: boundingBox?.left + scrollPos.x,
              width: boundingBox?.width,
              height: boundingBox?.height,
            }}
          >
            <div className="relative top-0 left-0 w-full">
              <div
                className="absolute top-[0px] right-[0px] truncate bg-bg-primary text-text-primary"
                style={{
                  fontSize: `${Math.min(boundingBox.height - 2, 10)}px`,
                  maxHeight: `${Math.min(boundingBox.height - 2, 16)}px`,
                  maxWidth: `${Math.min(boundingBox.width - 2, 300)}px`,
                }}
              >
                {boundingBox.joinedPaths}
              </div>
            </div>
          </div>
        );
      })}
      <DraggableValMenu
        {...props}
        mode={mode}
        setMode={setMode}
        loading={theme === null}
      />
    </div>
  );
}

function Window({
  editMode,
  setMode,
  setEditMode,
}: {
  editMode: EditMode;
  setMode: Dispatch<SetStateAction<OverlayModes>>;
  setEditMode: Dispatch<SetStateAction<EditMode | null>>;
}) {
  const [windowPos, setWindowPos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePosition = () => {
      if (ref.current) {
        const { innerWidth, innerHeight } = window;
        const { offsetWidth, offsetHeight } = ref.current;
        let newX = editMode.clientX;
        let newY = editMode.clientY;

        // Ensure the window stays inside the viewport horizontally
        if (newX + offsetWidth > innerWidth) {
          newX = innerWidth - offsetWidth - 10; // Add some padding
        } else if (newX < 0) {
          newX = 10; // Add some padding
        }

        // Try to place it below, otherwise above
        if (newY + offsetHeight > innerHeight) {
          newY = editMode.clientY - offsetHeight - 10; // Place above
        } else {
          newY = editMode.clientY + 10; // Place below
        }

        setWindowPos({ x: newX, y: newY });
      }
    };

    handlePosition();
  }, [editMode]);
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (isDragging) {
      const handleMouseMove = (ev: MouseEvent) => {
        setWindowPos((pos) => ({
          x: pos.x + ev.movementX,
          y: pos.y + ev.movementY,
        }));
      };
      const handleMouseUp = () => {
        setIsDragging(false);
      };
      const handleClick = () => {
        setIsDragging(false);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("click", handleClick);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        window.removeEventListener("click", handleClick);
      };
    }
  }, [isDragging]);
  useEffect(() => {
    const keydownListener = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setMode("select");
        setEditMode(null);
      }
    };
    window.addEventListener("keydown", keydownListener);

    return () => {
      window.removeEventListener("keydown", keydownListener);
    };
  }, []);

  return (
    <div className="fixed h-[100svh] w-[100svw] top-0 left-0 z-[8999]">
      <div
        className="fixed h-[100svh] w-[100svw] top-0 left-0"
        onClick={(ev) => {
          ev.preventDefault();
          if (!isDragging) {
            setMode("select");
            setEditMode(null);
          }
        }}
      ></div>
      {/**
       * We place the grab handles around the form, since we couldn't figure out to avoid
       * having the mouse down behaving weridly if other buttons (navigate to path) where clicked.
       *
       * TODO: fix this
       */}
      <div
        className="absolute grid grid-cols-[32px,1fr,32px] rounded bg-bg-primary text-text-primary"
        style={{
          top: windowPos.y,
          left: windowPos.x,
        }}
      >
        <div
          ref={ref}
          className="cursor-grab"
          onMouseDown={() => {
            setIsDragging(true);
          }}
        ></div>
        <div className="grid grid-rows-[32px,1fr,32px]">
          <div
            ref={ref}
            className="cursor-grab"
            onMouseDown={() => {
              setIsDragging(true);
            }}
          ></div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(ev) => {
              ev.stopPropagation();
              setMode("select");
              setEditMode(null);
            }}
          >
            {Internal.splitJoinedSourcePaths(editMode.joinedPaths).map(
              (path) => (
                <Fragment key={path}>
                  <CompressedPath disabled={false} path={path} />
                  <WindowField path={path} />
                </Fragment>
              ),
            )}
            <Button className="self-end" type="submit">
              Done
            </Button>
          </form>
          <div
            ref={ref}
            className="cursor-grab"
            onMouseDown={() => {
              setIsDragging(true);
            }}
          ></div>
        </div>
        <div
          ref={ref}
          className="cursor-grab"
          onMouseDown={() => {
            setIsDragging(true);
          }}
        ></div>
      </div>
    </div>
  );
}

function WindowField({ path: path }: { path: SourcePath }) {
  const schemaAtPath = useSchemaAtPath(path);

  if (!("data" in schemaAtPath) || schemaAtPath.data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <FieldLoading path={path} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <AnyField path={path} schema={schemaAtPath.data} autoFocus={true} />
    </div>
  );
}

function ValMenu({
  dropZone,
  ghost,
  draftMode,
  draftModeLoading,
  setDraftMode,
  mode,
  setMode,
  disableOverlay,
  loading,
}: {
  dropZone: DropZones;
  ghost?: boolean;
} & ValMenuProps) {
  const dir =
    dropZone === "val-menu-right-center" || dropZone === "val-menu-left-center"
      ? "vertical"
      : "horizontal";
  const authenticationState = useAuthenticationState();
  const { publish, publishDisabled } = usePublish();
  return (
    <div className="p-4 right-16">
      {/* See ValNextProvider: this same snippet is used there  */}
      {loading && (
        <div className={getPositionClassName(dropZone) + " p-4"}>
          <div className="flex items-center justify-center p-2 text-white bg-black rounded backdrop-blur">
            <Clock className="animate-spin" size={16} />
          </div>
        </div>
      )}
      {authenticationState === "login-required" && (
        <div className={getPositionClassName(dropZone) + " p-4"}>
          <div className="flex items-center justify-center p-2 text-white bg-black rounded backdrop-blur">
            <a
              href={urlOf("/api/val/authorize", {
                redirect_to: window.location.href,
              })}
            >
              <LogIn size={16} />
            </a>
          </div>
        </div>
      )}
      <PublishErrorDialog />
      <AnimateHeight
        isOpen={
          draftMode &&
          !draftModeLoading &&
          !loading &&
          authenticationState !== "login-required"
        }
      >
        <div
          className={classNames(
            "flex relative rounded bg-bg-primary text-text-primary gap-2",
            {
              "flex-col py-4 px-2": dir === "vertical",
              "flex-row px-4 py-2": dir === "horizontal",
              "opacity-70": ghost,
            },
          )}
        >
          <MenuButton
            label="Pick content"
            active={mode === "select"}
            onClick={() =>
              setMode((mode) => {
                if (mode === "select") {
                  return null;
                }
                return "select";
              })
            }
            icon={<SquareDashedMousePointer size={16} />}
          />
          <MenuButton label="Search" icon={<Search size={16} />} />
          <MenuButton
            label="Disable draft mode"
            disabled={draftModeLoading}
            icon={
              draftModeLoading ? (
                <Clock size={16} className="animate-spin" />
              ) : (
                <EyeOff size={16} />
              )
            }
            onClick={() => setDraftMode(false)}
          />
          <div className="pb-1 mt-1 border-t border-border-primary"></div>
          <MenuButton
            label="Publish"
            disabled={publishDisabled}
            variant="primary"
            onClick={() => {
              publish();
            }}
            icon={<Upload size={16} />}
          />
          <MenuButton
            label="Studio"
            icon={<PanelsTopLeft size={16} />}
            onClick={() => {
              window.location.href = window.origin + "/val/~";
            }}
          />
        </div>
      </AnimateHeight>
      <AnimateHeight
        isOpen={
          !(draftMode && !draftModeLoading) &&
          !loading &&
          authenticationState !== "login-required"
        }
      >
        <div
          className={classNames(
            "flex relative rounded bg-bg-primary text-text-primary gap-2",
            {
              "flex-col py-4 px-2": dir === "vertical",
              "flex-row px-4 py-2": dir === "horizontal",
              "opacity-70": ghost,
            },
          )}
        >
          <MenuButton
            label="Enable draft mode"
            disabled={draftModeLoading}
            icon={
              draftModeLoading ? (
                <Clock size={16} className="animate-spin" />
              ) : (
                <Edit size={16} />
              )
            }
            onClick={() => {
              setDraftMode(true);
            }}
          />
          <MenuButton
            label="Studio"
            icon={<PanelsTopLeft size={16} />}
            onClick={() => {
              window.location.href = window.origin + "/val/~";
            }}
          />
          <MenuButton
            label="Disable Val"
            icon={<X size={16} />}
            onClick={() => disableOverlay()}
          />
        </div>
      </AnimateHeight>
    </div>
  );
}

function MenuButton({
  icon,
  onClick,
  disabled,
  active,
  label,
  variant,
}: {
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  label?: string;
  variant?: "primary";
}) {
  return (
    <button
      disabled={disabled}
      className={classNames("p-2 rounded-full disabled:bg-bg-disabled", {
        "bg-bg-brand-primary text-text-brand-primary": variant === "primary",
        "border border-border-primary": !!active,
      })}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

function DraggableValMenu(props: ValMenuProps) {
  const defaultDropZone = "val-menu-right-center"; // TODO: get from config
  const [isDragging, setIsDragging] = useState(false);
  const [dropZone, setDropZone] = useState<DropZones | null>();
  const config = useValConfig();
  useEffect(() => {
    try {
      const storedDropZone =
        localStorage.getItem(
          "val-menu-drop-zone-" + (config?.project || "unknown"),
        ) || localStorage.getItem("val-menu-drop-zone-default");
      if (storedDropZone) {
        if (
          storedDropZone === "val-menu-left-top" ||
          storedDropZone === "val-menu-left-center" ||
          storedDropZone === "val-menu-left-bottom" ||
          storedDropZone === "val-menu-center-top" ||
          storedDropZone === "val-menu-center-bottom" ||
          storedDropZone === "val-menu-right-top" ||
          storedDropZone === "val-menu-right-center" ||
          storedDropZone === "val-menu-right-bottom"
        ) {
          setDropZone(storedDropZone);
        } else {
          throw new Error("Invalid drop zone: " + storedDropZone);
        }
      } else {
        setDropZone(defaultDropZone);
      }
    } catch (e) {
      console.error("Error getting drop zone from local storage", e);
      setDropZone(defaultDropZone);
    }
  }, []);
  const [dragOverDropZone, setDragOverDropZone] = useState<DropZones | null>(
    null,
  );
  const onDrop = (id: DropZones) => (event: React.DragEvent) => {
    event.preventDefault();
    setDropZone(id);
    try {
      localStorage.setItem(
        "val-menu-drop-zone-" + (config?.project || "unknown"),
        id,
      );
      localStorage.setItem("val-menu-drop-zone-default", id);
    } catch (e) {
      console.error("Error setting drop zone to local storage", e);
    }
  };
  const onDragOver = (id: DropZones) => (event: React.DragEvent) => {
    event.preventDefault();
    setDragOverDropZone(id);
  };
  return (
    <>
      {dropZone && (
        <div
          className={classNames(
            "z-[8999] cursor-grab",
            getPositionClassName(dropZone),
          )}
          draggable
          onDragStart={() => {
            setIsDragging(true);
          }}
          onDragEnd={() => {
            setIsDragging(false);
          }}
        >
          <ValMenu dropZone={dropZone} {...props} />
        </div>
      )}
      {isDragging && dropZone && (
        <>
          {dragOverDropZone && dragOverDropZone !== dropZone && (
            <div
              className={classNames(
                "z-[3]",
                getPositionClassName(dragOverDropZone),
              )}
              onDrop={onDrop(dragOverDropZone)}
              onDragOver={onDragOver(dragOverDropZone)}
            >
              <ValMenu dropZone={dragOverDropZone} ghost {...props} />
            </div>
          )}
          <div className="fixed top-0 left-0 grid w-screen h-screen grid-cols-3 grid-rows-3 z-[2]">
            <DropZone
              id="val-menu-left-top"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-center-top"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-right-top"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-left-center"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <div></div>
            <DropZone
              id="val-menu-right-center"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-left-bottom"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-center-bottom"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
            <DropZone
              id="val-menu-right-bottom"
              dropZone={dropZone}
              dragOverDropZone={dragOverDropZone}
              onDrop={onDrop}
              onDragOver={onDragOver}
            ></DropZone>
          </div>
        </>
      )}
    </>
  );
}

// NOTE: This is also used in ValNextProvider to display a loading spinner
function getPositionClassName(dropZone: string | null) {
  let className = "fixed transform";
  if (dropZone === "val-menu-left-top") {
    className += " left-0 top-0";
  } else if (dropZone === "val-menu-left-center") {
    className += " left-0 top-1/2 -translate-y-1/2";
  } else if (dropZone === "val-menu-left-bottom") {
    className += " left-0 bottom-0";
  } else if (dropZone === "val-menu-center-top") {
    className += " left-1/2 -translate-x-1/2 top-0";
  } else if (dropZone === "val-menu-center-bottom") {
    className += " left-1/2 -translate-x-1/2 bottom-0";
  } else if (dropZone === "val-menu-right-top") {
    className += " right-0 top-0";
  } else if (dropZone === "val-menu-right-center") {
    className += " right-0 top-1/2 -translate-y-1/2";
  } else if (dropZone === "val-menu-right-bottom") {
    className += " right-0 bottom-0";
  } else {
    className += " right-0 bottom-0";
  }
  return className;
}

const DropZone = ({
  id,
  onDrop,
  onDragOver,
}: {
  id: DropZones;
  onDrop: (id: DropZones) => (event: React.DragEvent) => void;
  onDragOver: (id: DropZones) => (event: React.DragEvent) => void;
  dropZone: DropZones;
  dragOverDropZone: DropZones | null;
}) => {
  return <div onDrop={onDrop(id)} onDragOver={onDragOver(id)}></div>;
};
