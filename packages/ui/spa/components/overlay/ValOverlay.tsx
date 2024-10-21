import classNames from "classnames";
import {
  Clock,
  Edit,
  EyeOff,
  PanelsTopLeft,
  Search,
  SquareDashedMousePointer,
  Upload,
  X,
} from "lucide-react";
import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { AnimateHeight } from "../../ng/components/AnimateHeight";
import { SourcePath } from "@valbuild/core";
import { StringField } from "../../ng/fields/StringField";
import { CompressedPath } from "../../ng/components/CompressedPath";
import { Button } from "../ui/button";

export type ValOverlayProps = {
  draftMode: boolean;
  draftModeLoading: boolean;
  setDraftMode: (draftMode: boolean) => void;
  disableOverlay: () => void;
};

type ValMenuProps = ValOverlayProps & {
  setMode: Dispatch<SetStateAction<OverlayModes>>;
  mode: OverlayModes;
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
  path: SourcePath;
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
      path: SourcePath;
    }[]
  >([]);
  const [isScrolling, setIsScrolling] = useState(false);
  const [scrollPos, setScrollPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const scrollListener = () => {
      setIsScrolling(true);
    };

    window.addEventListener("scroll", scrollListener, { passive: false });
    const scrollEndListener = () => {
      setScrollPos({ x: window.scrollX, y: window.scrollY });
      setIsScrolling(false);
    };
    window.addEventListener("scrollend", scrollEndListener, { passive: true });

    return () => {
      window.removeEventListener("scroll", scrollListener);
      window.removeEventListener("scrollend", scrollEndListener);
    };
  }, []);
  useEffect(() => {
    if (mode === "select" && !isScrolling) {
      let timeout: NodeJS.Timeout;
      const updateElements = () => {
        const newBoundingBoxes: {
          top: number;
          left: number;
          width: number;
          height: number;
          path: SourcePath;
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
            path: path as SourcePath,
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
  return (
    <>
      {editMode !== null && (
        <Window
          editMode={editMode}
          setMode={setMode}
          setEditMode={setEditMode}
        />
      )}
      {!isScrolling &&
        boundingBoxes.map((boundingBox, i) => {
          return (
            <div
              className="absolute border border-bg-primary hover:border-2 z-[8998]"
              onClickCapture={(ev) => {
                ev.stopPropagation();
                console.log("clicked", boundingBox.path);
                setMode(null);
                setEditMode({
                  path: boundingBox.path,
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
                  {boundingBox.path}
                </div>
              </div>
            </div>
          );
        })}
      <DraggableValMenu {...props} mode={mode} setMode={setMode} />
    </>
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
            <CompressedPath disabled={false} path={editMode.path} />
            <StringField path={editMode.path} autoFocus />
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

function ValMenu({
  dropZone,
  ghost,
  draftMode,
  draftModeLoading,
  setDraftMode,
  mode,
  setMode,
  disableOverlay,
}: {
  dropZone: DropZones;
  ghost?: boolean;
} & ValMenuProps) {
  const dir =
    dropZone === "val-menu-right-center" || dropZone === "val-menu-left-center"
      ? "vertical"
      : "horizontal";
  return (
    <div className="p-4">
      <AnimateHeight isOpen={draftMode && !draftModeLoading}>
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
            variant="primary"
            icon={<Upload size={16} />}
          />
          <MenuButton
            label="Studio"
            icon={<PanelsTopLeft size={16} />}
            onClick={() => {
              window.open("/val");
            }}
          />
        </div>
      </AnimateHeight>
      <AnimateHeight isOpen={!(draftMode && !draftModeLoading)}>
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
  const [isDragging, setIsDragging] = useState(false);
  const [dropZone, setDropZone] = useState<DropZones>("val-menu-right-center");
  const [dragOverDropZone, setDragOverDropZone] = useState<DropZones | null>(
    null,
  );
  const onDrop = (id: DropZones) => (event: React.DragEvent) => {
    event.preventDefault();
    setDropZone(id);
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
            "z-overlay cursor-grab",
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

function getPositionClassName(dropZone: DropZones) {
  return classNames("fixed transform", {
    "left-0 top-0": dropZone === "val-menu-left-top",
    "left-0 top-1/2 -translate-y-1/2": dropZone === "val-menu-left-center",
    "left-0 bottom-0": dropZone === "val-menu-left-bottom",
    "left-1/2 -translate-x-1/2 top-0": dropZone === "val-menu-center-top",
    "left-1/2 -translate-x-1/2 bottom-0": dropZone === "val-menu-center-bottom",
    "right-0 top-0": dropZone === "val-menu-right-top",
    "right-0 top-1/2 -translate-y-1/2": dropZone === "val-menu-right-center",
    "right-0 bottom-0": dropZone === "val-menu-right-bottom",
  });
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
