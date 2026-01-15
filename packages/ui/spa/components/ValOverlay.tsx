import classNames from "classnames";
import {
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  GripHorizontal,
  LogIn,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  PanelsTopLeft,
  SquareDashedMousePointer,
  Upload,
  X,
} from "lucide-react";
import React, {
  Dispatch,
  SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimateHeight } from "./AnimateHeight";
import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import { Button } from "./designSystem/button";
import { AnyField } from "./AnyField";
import {
  useAllValidationErrors,
  useAuthenticationState,
  useCurrentPatchIds,
  useLoadingStatus,
  useSchemaAtPath,
  useTheme,
  useValConfig,
  useValMode,
  useValPortal,
  usePublishSummary,
  useSchemas,
  useShallowModulesAtPaths,
} from "./ValProvider";
import { FieldLoading } from "./FieldLoading";
import { urlOf } from "@valbuild/shared/internal";
import { Popover, PopoverContent } from "./designSystem/popover";
import { PopoverClose, PopoverTrigger } from "@radix-ui/react-popover";
import { Switch } from "./designSystem/switch";
import { DraftChanges } from "./DraftChanges";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "./designSystem/hover-card";
import { PublishButton } from "./PublishButton";
import { ScrollArea } from "./designSystem/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./designSystem/select";
import { AnimatedClock } from "./AnimatedClock";
import { VERCEL_STEGA_REGEX, vercelStegaDecode } from "@vercel/stega";
import { cn } from "./designSystem/cn";
import { HoverCardArrow } from "@radix-ui/react-hover-card";

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
  setDropZone: (dropZone: DropZones | null) => void;
  dropZone: DropZones | null;
  findAllValPathElements: () => Array<{
    top: number;
    left: number;
    width: number;
    height: number;
    joinedPaths: string;
  }>;
  setAllBoundingBoxes: Dispatch<
    SetStateAction<
      Array<{
        top: number;
        left: number;
        width: number;
        height: number;
        joinedPaths: string;
      }>
    >
  >;
  setShowAllBoundingBoxes: Dispatch<SetStateAction<boolean>>;
  setAllBoundingBoxesVisible: Dispatch<SetStateAction<boolean>>;
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
  const [editMode, setEditMode] = useState<EditMode | null>(null);

  const [boundingBox, setBoundingBox] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    joinedPaths: string;
  } | null>(null);
  const [showAllBoundingBoxes, setShowAllBoundingBoxes] = useState(false);
  const [allBoundingBoxesVisible, setAllBoundingBoxesVisible] = useState(false);
  const [allBoundingBoxes, setAllBoundingBoxes] = useState<
    Array<{
      top: number;
      left: number;
      width: number;
      height: number;
      joinedPaths: string;
    }>
  >([]);
  useEffect(() => {
    if (!props.draftMode) {
      setMode(null);
      setEditMode(null);
      setBoundingBox(null);
      setShowAllBoundingBoxes(false);
      setAllBoundingBoxesVisible(false);
      setAllBoundingBoxes([]);
    }
  }, [props.draftMode]);
  useEffect(() => {
    if (mode === "select" && editMode === null) {
      const listener = (clientX: number, clientY: number) => {
        const elements = document.elementsFromPoint(clientX, clientY);
        let boundingBox: {
          top: number;
          left: number;
          width: number;
          height: number;
          joinedPaths: string;
        } | null = null;
        for (const el of elements) {
          if (el instanceof HTMLElement) {
            let path = el.getAttribute("data-val-path");
            if (
              !path &&
              el.textContent &&
              el.textContent.match(VERCEL_STEGA_REGEX)
            ) {
              const cleanText = vercelStegaDecode(el.textContent);
              if (
                cleanText &&
                typeof cleanText === "object" &&
                "data" in cleanText &&
                typeof cleanText.data === "object" &&
                cleanText.data &&
                "valPath" in cleanText.data &&
                typeof cleanText.data.valPath === "string"
              ) {
                path = cleanText.data.valPath;
              }
            }
            if (path) {
              // If this is a <source> element, use its parent <video> or <picture> element instead
              let targetElement = el;
              if (el.tagName === "SOURCE") {
                const parent = el.parentElement;
                if (
                  parent &&
                  (parent.tagName === "VIDEO" || parent.tagName === "PICTURE")
                ) {
                  targetElement = parent;
                }
              }

              const rect = targetElement.getBoundingClientRect();
              boundingBox = {
                top: rect.top + window.scrollY,
                left: rect.left + window.scrollX,
                width: rect.width,
                height: rect.height,
                joinedPaths: path,
              };
            }
          }
        }
        if (boundingBox) {
          setBoundingBox(boundingBox);
        }
      };
      const touchListener = (ev: TouchEvent) => {
        listener(ev.touches[0].clientX, ev.touches[0].clientY);
      };
      const mouseListener = (ev: MouseEvent) => {
        listener(ev.clientX, ev.clientY);
      };
      const mouseLeaveListener = () => {
        setBoundingBox(null);
      };
      const resizeListener = () => {
        setBoundingBox(null);
      };
      window.addEventListener("mousemove", mouseListener);
      window.addEventListener("touchmove", touchListener);
      window.addEventListener("touchstart", touchListener);
      window.addEventListener("mouseleave", mouseLeaveListener);
      window.addEventListener("resize", resizeListener);
      return () => {
        window.removeEventListener("mousemove", mouseListener);
        window.removeEventListener("touchmove", touchListener);
        window.removeEventListener("touchstart", touchListener);
        window.removeEventListener("mouseleave", mouseLeaveListener);
        window.removeEventListener("resize", resizeListener);
        setBoundingBox(null);
      };
    } else {
      // Clear bounding box when not in select mode
      setBoundingBox(null);
    }
  }, [editMode, mode]);
  useEffect(() => {
    if (mode === "select" && editMode === null) {
      const keyDownListener = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          setMode(null);
          setBoundingBox(null);
        }
      };
      window.addEventListener("keydown", keyDownListener);
      return () => {
        window.removeEventListener("keydown", keyDownListener);
      };
    }
  }, [mode, editMode]);

  const { theme } = useTheme();
  const [dropZone, setDropZoneRaw] = useState<DropZones | null>(null);
  const config = useValConfig();
  const defaultDropZone = "val-menu-right-center"; // TODO: get from config
  useEffect(() => {
    try {
      const storedDropZone =
        (config &&
          localStorage.getItem(
            "val-menu-drop-zone-" + (config?.project || "unknown"),
          )) ||
        localStorage.getItem("val-menu-drop-zone-default");
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
          setDropZoneRaw(storedDropZone);
        } else {
          throw new Error("Invalid drop zone: " + storedDropZone);
        }
      } else {
        setDropZoneRaw(defaultDropZone);
      }
    } catch (e) {
      console.error("Error getting drop zone from local storage", e);
      setDropZoneRaw(defaultDropZone);
    }
  }, [config]);
  const setDropZone = (dropZone: DropZones | null) => {
    setDropZoneRaw(dropZone);
    try {
      if (dropZone) {
        localStorage.setItem(
          "val-menu-drop-zone-" + (config?.project || "unknown"),
          dropZone,
        );
        localStorage.setItem("val-menu-drop-zone-default", dropZone);
      }
    } catch (e) {
      console.error("Error setting drop zone to local storage", e);
    }
  };

  const findAllValPathElements = () => {
    const elements = document.querySelectorAll("[data-val-path]");
    const boxes: Array<{
      top: number;
      left: number;
      width: number;
      height: number;
      joinedPaths: string;
    }> = [];

    elements.forEach((el) => {
      if (el instanceof HTMLElement) {
        const path = el.getAttribute("data-val-path");
        if (path) {
          // If this is a <source> element, use its parent <video> or <picture> element instead
          let targetElement = el;
          if (el.tagName === "SOURCE") {
            const parent = el.parentElement;
            if (
              parent &&
              (parent.tagName === "VIDEO" || parent.tagName === "PICTURE")
            ) {
              targetElement = parent;
            }
          }

          const rect = targetElement.getBoundingClientRect();
          boxes.push({
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
            height: rect.height,
            joinedPaths: path,
          });
        }
      }
    });

    return boxes;
  };

  return (
    <div {...(theme ? { "data-mode": theme } : {})} id="val-overlay-container">
      <Window editMode={editMode} setMode={setMode} setEditMode={setEditMode} />
      {boundingBox && (
        <div
          className={cn(
            "absolute z-[8998]",
            "cursor-pointer",
            "rounded-sm",
            "transition-all duration-150 ease-in-out",
            "border-2 border-bg-brand-primary hover:border-bg-brand-primary-hover",
          )}
          style={maxRect(
            {
              top: boundingBox.top,
              left: boundingBox.left,
              width: boundingBox.width,
              height: boundingBox.height,
            },
            {
              top: window.scrollY,
              left: window.scrollX,
              width: window.innerWidth,
              height: window.innerHeight,
            },
            2,
          )}
          onClick={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setBoundingBox(null);
            setEditMode({
              joinedPaths: boundingBox.joinedPaths,
              clientX: boundingBox.left,
              clientY: boundingBox.top,
              boundingBox: {
                top: boundingBox.top,
                left: boundingBox.left,
                width: boundingBox.width,
                height: boundingBox.height,
              },
            });
          }}
        ></div>
      )}
      {showAllBoundingBoxes &&
        allBoundingBoxes.map((box, index) => (
          <div
            key={`${box.joinedPaths}-${index}`}
            className={cn(
              "absolute z-[8997] pointer-events-none",
              "rounded-sm",
              "border-2 border-bg-brand-primary",
              "transition-opacity duration-200 ease-out",
              allBoundingBoxesVisible ? "opacity-50" : "opacity-0",
            )}
            style={maxRect(
              {
                top: box.top,
                left: box.left,
                width: box.width,
                height: box.height,
              },
              {
                top: window.scrollY,
                left: window.scrollX,
                width: window.innerWidth,
                height: window.innerHeight,
              },
              2,
            )}
          />
        ))}
      {editMode === null && (
        <DraggableValMenu
          {...props}
          mode={mode}
          setMode={setMode}
          loading={theme === null}
          dropZone={dropZone}
          setDropZone={setDropZone}
          findAllValPathElements={findAllValPathElements}
          setAllBoundingBoxes={setAllBoundingBoxes}
          setShowAllBoundingBoxes={setShowAllBoundingBoxes}
          setAllBoundingBoxesVisible={setAllBoundingBoxesVisible}
        />
      )}
    </div>
  );
}

function Window({
  editMode,
  setMode,
  setEditMode,
}: {
  editMode: EditMode | null;
  setMode: Dispatch<SetStateAction<OverlayModes>>;
  setEditMode: Dispatch<SetStateAction<EditMode | null>>;
}) {
  // place outside viewport initially
  const [windowPos, setWindowPos] = useState({
    x: window.innerWidth,
    y: window.innerHeight,
  });
  const [windowSize, setWindowSize] = useState({
    width: 0,
    height: 0,
  });
  const [windowInnerWidth, setWindowInnerWidth] = useState(window.innerWidth);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = windowInnerWidth < 1024;
  const [isResizing, setIsResizing] = useState<"se" | "e" | "s" | null>(null);

  useEffect(() => {
    const handlePosition = () => {
      if (editMode) {
        setTimeout(() => {
          if (ref.current) {
            const { innerWidth, innerHeight } = window;
            const { offsetWidth, offsetHeight } = ref.current;
            let newX = editMode.clientX;
            let newY = editMode.clientY;
            const padding = 20;

            // Set initial size
            setWindowSize({ width: offsetWidth, height: offsetHeight });

            // Keep window within viewport bounds
            if (newX + offsetWidth > innerWidth - padding) {
              newX = innerWidth - offsetWidth - padding;
            }
            if (newX < padding) {
              newX = padding;
            }
            if (newY + offsetHeight > innerHeight - padding) {
              newY = innerHeight - offsetHeight - padding;
            }
            if (newY < padding) {
              newY = padding;
            }

            setWindowPos({ x: newX, y: newY });
          }
        }, 100);
      } else {
        setWindowPos({ x: window.innerWidth, y: window.innerHeight });
        setWindowSize({ width: 0, height: 0 });
      }
    };

    if (window.innerWidth < 1024) {
      setWindowPos({ x: 16, y: 16 });
    } else {
      handlePosition();
    }
  }, [editMode]);

  useEffect(() => {
    const handleResize = () => {
      setWindowInnerWidth(window.innerWidth);
      if (window.innerWidth < 1024) {
        setWindowPos({ x: 16, y: 16 });
      } else if (ref.current) {
        // On desktop, constrain position if window is now out of bounds
        setWindowPos((pos) => {
          const { innerWidth, innerHeight } = window;
          const { offsetWidth } = ref.current!;

          const minVisible = 100;
          const maxX = innerWidth - minVisible;
          const maxY = innerHeight - minVisible;
          const minX = -(offsetWidth - minVisible);
          const minY = 0;

          const newX = Math.max(minX, Math.min(maxX, pos.x));
          const newY = Math.max(minY, Math.min(maxY, pos.y));

          return { x: newX, y: newY };
        });
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    if (isDragging && !isMobile) {
      const handleMove = (ev: MouseEvent) => {
        setWindowPos((pos) => {
          if (!ref.current) return pos;

          const { innerWidth, innerHeight } = window;
          const { offsetWidth } = ref.current;

          // Calculate new position
          let newX = pos.x + ev.movementX;
          let newY = pos.y + ev.movementY;

          // Constrain to viewport - keep at least 100px of the window visible
          const minVisible = 100;
          const maxX = innerWidth - minVisible;
          const maxY = innerHeight - minVisible;
          const minX = -(offsetWidth - minVisible);
          const minY = 0;

          newX = Math.max(minX, Math.min(maxX, newX));
          newY = Math.max(minY, Math.min(maxY, newY));

          return { x: newX, y: newY };
        });
      };
      const handleMoveEnd = () => {
        setIsDragging(false);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleMoveEnd);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleMoveEnd);
      };
    }
  }, [isDragging, isMobile]);

  useEffect(() => {
    if (isResizing && !isMobile) {
      const handleResize = (ev: MouseEvent) => {
        const minWidth = 400;
        const minHeight = 300;
        const { innerWidth, innerHeight } = window;

        if (isResizing === "se" || isResizing === "e") {
          setWindowSize((size) => {
            const newWidth = Math.max(
              minWidth,
              Math.min(
                innerWidth - windowPos.x - 20,
                size.width + ev.movementX,
              ),
            );
            return { ...size, width: newWidth };
          });
        }
        if (isResizing === "se" || isResizing === "s") {
          setWindowSize((size) => {
            const newHeight = Math.max(
              minHeight,
              Math.min(
                innerHeight - windowPos.y - 20,
                size.height + ev.movementY,
              ),
            );
            return { ...size, height: newHeight };
          });
        }
      };
      const handleResizeEnd = () => {
        setIsResizing(null);
      };
      window.addEventListener("mousemove", handleResize);
      window.addEventListener("mouseup", handleResizeEnd);
      return () => {
        window.removeEventListener("mousemove", handleResize);
        window.removeEventListener("mouseup", handleResizeEnd);
      };
    }
  }, [isResizing, isMobile, windowPos.x, windowPos.y]);

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

  const handleClose = () => {
    setMode("select");
    setEditMode(null);
  };

  return (
    <div
      className={classNames("fixed top-0 left-0 z-[8998]", {
        hidden: editMode === null,
        "opacity-100 w-[200svw] h-[100svh]": editMode !== null && !isMobile,
        "opacity-100 w-[100vw] h-[100svh]": editMode !== null && isMobile,
      })}
    >
      <div
        className={classNames("fixed top-0 left-0", {
          hidden: editMode === null,
          "w-[100vw] h-[100svh]": editMode !== null,
        })}
        onClick={(ev) => {
          ev.preventDefault();
          if (!isDragging) {
            handleClose();
          }
        }}
      ></div>
      <div
        className={classNames(
          "absolute flex flex-col rounded-lg bg-bg-primary text-fg-primary border border-border-secondary",
          "shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1),0_8px_10px_-6px_rgba(0,0,0,0.1)]",
          {
            "w-[calc(100vw-32px)] h-[calc(100svh-32px)] max-h-[calc(100svh-32px)]":
              isMobile,
          },
        )}
        ref={ref}
        style={{
          top: windowPos.y,
          left: windowPos.x,
          ...(!isMobile && windowSize.width > 0
            ? {
                width: windowSize.width,
                height: windowSize.height,
              }
            : !isMobile
              ? { maxWidth: "640px" }
              : {}),
        }}
      >
        {/* Header bar - for dragging on desktop, shows close button on mobile */}
        <div
          className={classNames(
            "grid grid-cols-3 items-center px-4 py-3 border-b border-border-secondary rounded-t-lg bg-gradient-to-b from-bg-secondary/30 to-bg-primary",
            "shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_1px_2px_-1px_rgba(0,0,0,0.1)]",
            {
              "cursor-grab active:cursor-grabbing": !isMobile,
            },
          )}
          onMouseDown={(ev) => {
            if (!isMobile) {
              ev.preventDefault();
              setIsDragging(true);
            }
          }}
        >
          <div className="text-sm font-semibold text-fg-primary">
            Edit Content
          </div>
          <div className="flex justify-center">
            {!isMobile && (
              <GripHorizontal size={16} className="text-fg-secondary" />
            )}
          </div>
          <div className="flex justify-end">
            {isMobile && (
              <button
                onClick={handleClose}
                className="p-1 rounded hover:bg-bg-secondary transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        {/* Content area with scroll */}
        <div
          className={classNames("flex-1 overflow-y-auto", {
            "p-6": !isMobile,
            "p-4": isMobile,
          })}
        >
          <form
            className="flex flex-col gap-6 w-full"
            onSubmit={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              handleClose();
            }}
          >
            {editMode && (
              <>
                {/* Fields */}
                {Internal.splitJoinedSourcePaths(editMode.joinedPaths).map(
                  (path) => {
                    const hasMultipleFields =
                      Internal.splitJoinedSourcePaths(editMode.joinedPaths)
                        .length > 1;
                    return (
                      <WindowField
                        key={path}
                        path={path}
                        showInlineStudioLink={hasMultipleFields}
                      />
                    );
                  },
                )}
              </>
            )}
            <div className="flex items-center justify-between gap-3 pt-2 border-t border-border-secondary">
              {/* Show Studio button at bottom if only one field */}
              {editMode &&
                Internal.splitJoinedSourcePaths(editMode.joinedPaths).length ===
                  1 && (
                  <a
                    href={
                      window.origin +
                      "/val/~" +
                      Internal.splitJoinedSourcePaths(editMode.joinedPaths)[0]
                    }
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border-primary bg-bg-secondary hover:bg-bg-secondary-hover text-fg-primary transition-colors"
                  >
                    <ExternalLink size={16} />
                    <span>Open Studio</span>
                  </a>
                )}
              <div className="flex-1" />
              <Button type="submit">Done</Button>
            </div>
          </form>
        </div>

        {/* Resize handles - desktop only */}
        {!isMobile && (
          <>
            {/* Right edge resize handle */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-bg-brand-primary/50 transition-colors"
              onMouseDown={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setIsResizing("e");
              }}
            />
            {/* Bottom edge resize handle */}
            <div
              className="absolute bottom-0 left-0 w-full h-1 cursor-ns-resize hover:bg-bg-brand-primary/50 transition-colors"
              onMouseDown={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setIsResizing("s");
              }}
            />
            {/* Bottom-right corner resize handle */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize group"
              onMouseDown={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setIsResizing("se");
              }}
            >
              <svg
                className="absolute bottom-0.5 right-0.5 w-3 h-3 text-fg-tertiary group-hover:text-fg-secondary transition-colors"
                viewBox="0 0 12 12"
                fill="none"
              >
                <path
                  d="M10 2L2 10M10 6L6 10M10 10H10.01"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const buttonClassName =
  "p-2 rounded-md disabled:bg-bg-disabled transition-colors border";
const buttonInactiveClassName = "hover:bg-bg-primary-hover border-bg-primary";

function WindowField({
  path: path,
  showInlineStudioLink,
}: {
  path: SourcePath;
  showInlineStudioLink: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  const studioUrl = window.origin + "/val/~" + path;

  if (!("data" in schemaAtPath) || schemaAtPath.data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <FieldLoading path={path} />
      </div>
    );
  }

  if (showInlineStudioLink) {
    return (
      <div className="flex flex-col gap-2 w-full">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <AnyField path={path} schema={schemaAtPath.data} autoFocus={true} />
          </div>
          <a
            href={studioUrl}
            className="flex-shrink-0 p-2 rounded-md border border-border-primary bg-bg-secondary hover:bg-bg-secondary-hover text-fg-secondary hover:text-fg-primary transition-colors mt-1"
            title="Open in Studio"
            aria-label="Open in Studio"
          >
            <ExternalLink size={16} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full">
      <AnyField path={path} schema={schemaAtPath.data} autoFocus={true} />
    </div>
  );
}

function DropZoneLabel({ dropZone }: { dropZone: DropZones }) {
  if (dropZone === "val-menu-left-top") {
    return (
      <div className="flex items-center gap-2">
        <PanelTop className="w-4 h-4" />
        <span>Left Top</span>
      </div>
    );
  } else if (dropZone === "val-menu-left-center") {
    return (
      <div className="flex items-center gap-2">
        <PanelLeft className="w-4 h-4" />
        <span>Left Center</span>
      </div>
    );
  } else if (dropZone === "val-menu-left-bottom") {
    return (
      <div className="flex items-center gap-2">
        <PanelBottom className="w-4 h-4" />
        <span>Left Bottom</span>
      </div>
    );
  } else if (dropZone === "val-menu-center-top") {
    return (
      <div className="flex items-center gap-2">
        <PanelTop className="w-4 h-4" />
        <span>Center Top</span>
      </div>
    );
  } else if (dropZone === "val-menu-center-bottom") {
    return (
      <div className="flex items-center gap-2">
        <PanelBottom className="w-4 h-4" />
        <span>Center Bottom</span>
      </div>
    );
  } else if (dropZone === "val-menu-right-top") {
    return (
      <div className="flex items-center gap-2">
        <PanelTop className="w-4 h-4" />
        <span>Right Top</span>
      </div>
    );
  } else if (dropZone === "val-menu-right-center") {
    return (
      <div className="flex items-center gap-2">
        <PanelRight className="w-4 h-4" />
        <span>Right Center</span>
      </div>
    );
  } else if (dropZone === "val-menu-right-bottom") {
    return (
      <div className="flex items-center gap-2">
        <PanelBottom className="w-4 h-4" />
        <span>Right Bottom</span>
      </div>
    );
  } else {
    console.warn("Unknown drop zone:", dropZone);
    return null;
  }
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
  setDropZone,
  findAllValPathElements,
  setAllBoundingBoxes,
  setShowAllBoundingBoxes,
  setAllBoundingBoxesVisible,
}: {
  dropZone: DropZones;
  ghost?: boolean;
} & ValMenuProps) {
  const dir =
    dropZone === "val-menu-right-center" || dropZone === "val-menu-left-center"
      ? "vertical"
      : "horizontal";
  const authenticationState = useAuthenticationState();
  const portalContainer = useValPortal();

  const showAllBoundingBoxesWithFadeIn = () => {
    const boxes = findAllValPathElements();
    setAllBoundingBoxes(boxes);
    setShowAllBoundingBoxes(true);
    setAllBoundingBoxesVisible(false);

    // Fade in after a brief moment
    setTimeout(() => {
      setAllBoundingBoxesVisible(true);
    }, 50);
  };

  const hideAllBoundingBoxesWithFadeOut = () => {
    setAllBoundingBoxesVisible(false);

    // Remove from DOM after fade-out completes
    setTimeout(() => {
      setShowAllBoundingBoxes(false);
    }, 200);
  };
  const { theme, setTheme } = useTheme();
  const loadingStatus = useLoadingStatus();
  const [publishPopoverSideOffset, setPublishPopoverSideOffset] = useState(0);
  const patchIds = useCurrentPatchIds();
  const validationErrors = useAllValidationErrors() || {};
  const validationErrorCount = Object.keys(validationErrors).length;
  const valMode = useValMode();
  // TODO: refactor all resize handlers into a hook
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 400) {
        setPublishPopoverSideOffset(-56);
      } else {
        setPublishPopoverSideOffset(32);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);
  const { publishDisabled } = usePublishSummary();
  const sourcePathResult = useValRouterSourcePathFromCurrentPathname();
  const publishPopoverSide =
    dropZone === "val-menu-center-bottom"
      ? "top"
      : dropZone === "val-menu-center-top"
        ? "bottom"
        : dropZone === "val-menu-right-center"
          ? "left"
          : dropZone === "val-menu-left-center"
            ? "right"
            : dropZone === "val-menu-left-bottom"
              ? "top"
              : dropZone === "val-menu-right-bottom"
                ? "top"
                : dropZone === "val-menu-right-top"
                  ? "bottom"
                  : dropZone === "val-menu-left-top"
                    ? "bottom"
                    : "top";
  const allDropZones: DropZones[] = [
    "val-menu-left-top",
    "val-menu-left-center",
    "val-menu-left-bottom",
    "val-menu-center-top",
    "val-menu-center-bottom",
    "val-menu-right-top",
    "val-menu-right-center",
    "val-menu-right-bottom",
  ];
  return (
    <div className="p-4 right-16">
      {/* See ValNextProvider: this same snippet is used there  */}
      {loading && (
        <div className={getPositionClassName(dropZone) + " p-4"}>
          <div className="flex items-center justify-center p-2 text-white bg-black rounded backdrop-blur">
            <AnimatedClock size={16} />
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
            "flex relative rounded bg-bg-primary border border-border-primary text-fg-primary gap-2",
            {
              "flex-col py-4 px-2": dir === "vertical",
              "flex-row px-4 py-2 items-center": dir === "horizontal",
              "opacity-70": ghost,
            },
          )}
        >
          <HoverCard>
            <HoverCardTrigger className="inline-flex">
              <MenuButton
                active={mode === "select"}
                onClick={() => {
                  const newMode = mode === "select" ? null : "select";
                  setMode(newMode);

                  // Clean up if exiting select mode
                  if (newMode !== "select") {
                    setShowAllBoundingBoxes(false);
                    setAllBoundingBoxesVisible(false);
                  } else {
                    showAllBoundingBoxesWithFadeIn();
                  }
                }}
                onMouseEnter={() => {
                  if (mode === "select") {
                    showAllBoundingBoxesWithFadeIn();
                  }
                }}
                onMouseLeave={() => {
                  if (mode === "select") {
                    hideAllBoundingBoxesWithFadeOut();
                  }
                }}
                icon={<SquareDashedMousePointer size={16} />}
              />
            </HoverCardTrigger>
            <HoverCardContent side={publishPopoverSide} className="z-50" container={portalContainer}>
              Click on content in the page to select and edit it
              <HoverCardArrow className="z-50 fill-bg-secondary-hover" />
            </HoverCardContent>
          </HoverCard>
          <HoverCard>
            <HoverCardTrigger className="inline-flex">
              <MenuButton
                disabled={draftModeLoading}
                icon={
                  draftModeLoading ? (
                    <AnimatedClock size={16} />
                  ) : (
                    <EyeOff size={16} />
                  )
                }
                onClick={() => setDraftMode(false)}
              />
            </HoverCardTrigger>
            <HoverCardContent side={publishPopoverSide} className="z-50" container={portalContainer}>
              Exit preview mode to see the currently published version of your
              content
              <HoverCardArrow className="z-50 fill-bg-secondary-hover" />
            </HoverCardContent>
          </HoverCard>
          <div className="pb-1 mt-1 border-t border-border-primary"></div>
          <Popover>
            <PopoverTrigger
              disabled={publishDisabled}
              className={cn(
                buttonClassName,
                buttonInactiveClassName,
                "inline-flex p-0",
              )}
            >
              <HoverCard>
                <HoverCardTrigger className="inline-flex p-2">
                  <div className="relative">
                    {patchIds.length > 0 && (
                      <div className="absolute -top-3 -right-3">
                        <div
                          className={classNames(
                            "w-4 h-4 text-[9px] leading-4 text-center rounded-full",
                            {
                              "bg-bg-brand-primary": validationErrorCount === 0,
                              "bg-bg-error-primary text-fg-error-primary":
                                validationErrorCount > 0,
                            },
                          )}
                        >
                          {validationErrorCount === 0 &&
                            patchIds.length > 9 && <span>9+</span>}
                          {validationErrorCount === 0 &&
                            patchIds.length <= 9 && (
                              <span>{patchIds.length}</span>
                            )}
                          {validationErrorCount > 9 && <span>9+</span>}
                          {validationErrorCount <= 9 &&
                            validationErrorCount > 0 && (
                              <span>{validationErrorCount}</span>
                            )}
                        </div>
                      </div>
                    )}
                    <Upload size={16} />
                  </div>
                </HoverCardTrigger>
                <HoverCardContent side={publishPopoverSide} className="z-50" container={portalContainer}>
                  {validationErrorCount > 0 && (
                    <div className="text-fg-error-primary">
                      Cannot {valMode === "fs" ? "save" : "publish"} due to{" "}
                      {validationErrorCount} validation error
                      {validationErrorCount > 1 && "s"}
                    </div>
                  )}
                  {patchIds.length > 0 && validationErrorCount == 0 && (
                    <div>
                      {patchIds.length} patch
                      {patchIds.length > 1 && "es"} ready to publish
                    </div>
                  )}
                  <HoverCardArrow className="z-50 fill-bg-secondary-hover" />
                </HoverCardContent>
              </HoverCard>
            </PopoverTrigger>
            <PopoverContent
              container={portalContainer}
              align="center"
              side={publishPopoverSide}
              sideOffset={publishPopoverSideOffset}
              className="z-[9000] relative max-w-[352px] w-screen rounded-none sm:rounded flex flex-col items-end"
            >
              <div className="absolute top-4 right-4 sm:hidden">
                <PopoverClose>
                  <X size={16} />
                </PopoverClose>
              </div>
              {!publishDisabled && (
                <div className="flex items-center justify-between gap-4 px-4 py-4 pt-8 sm:hidden">
                  <PublishButton />
                </div>
              )}
              <ScrollArea>
                <div className="sm:max-h-[min(400px,80svh)] max-h-[calc(100svh-96px-64px)] w-[320px]">
                  <DraftChanges loadingStatus={loadingStatus} />
                </div>
              </ScrollArea>
              {!publishDisabled && (
                <div className="hidden py-4 sm:block">
                  <PublishButton />
                </div>
              )}
            </PopoverContent>
          </Popover>
          <HoverCard>
            <HoverCardTrigger
              className={cn(
                buttonClassName,
                buttonInactiveClassName,
                "inline-flex p-2",
              )}
              asChild
            >
              <MenuButton
                icon={
                  sourcePathResult.status === "success" &&
                  sourcePathResult.data ? (
                    <Globe size={16} />
                  ) : (
                    <PanelsTopLeft size={16} />
                  )
                }
                href={
                  window.origin +
                  "/val/~" +
                  (sourcePathResult.status === "success" &&
                  sourcePathResult.data
                    ? sourcePathResult.data
                    : "")
                }
              />
            </HoverCardTrigger>
            <HoverCardContent side={publishPopoverSide} className="z-50" container={portalContainer}>
              Open Val Studio to edit and manage your content
              <HoverCardArrow className="z-50 fill-bg-secondary-hover" />
            </HoverCardContent>
          </HoverCard>
          <Popover>
            <PopoverTrigger
              className={classNames(buttonClassName, buttonInactiveClassName)}
            >
              <Ellipsis size={16} />
            </PopoverTrigger>
            <PopoverContent container={portalContainer} className="z-[9003]">
              <div className="grid grid-cols-[1fr,auto] gap-2 items-center">
                <span>Position</span>
                <Select
                  value={dropZone}
                  onValueChange={(value) => {
                    setDropZone(value as DropZones);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      <DropZoneLabel dropZone={dropZone} />
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent
                    container={portalContainer}
                    className="z-[9004]"
                  >
                    {allDropZones.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        <DropZoneLabel dropZone={zone} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setTheme("dark");
                    } else {
                      setTheme("light");
                    }
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
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
            "flex relative rounded bg-bg-primary text-fg-primary gap-2 justify-center items-center",
            {
              "flex-col py-4 px-2": dir === "vertical",
              "flex-row px-4 py-2": dir === "horizontal",
              "opacity-70": ghost,
            },
          )}
        >
          <MenuButton
            label="Enable preview mode"
            disabled={draftModeLoading}
            icon={
              draftModeLoading ? <AnimatedClock size={16} /> : <Eye size={16} />
            }
            onClick={() => {
              setDraftMode(true);
            }}
          />
          <MenuButton
            label="Studio"
            icon={
              sourcePathResult.status === "success" && sourcePathResult.data ? (
                <Globe size={16} />
              ) : (
                <PanelsTopLeft size={16} />
              )
            }
            href={
              window.origin +
              "/val/~" +
              (sourcePathResult.status === "success" && sourcePathResult.data
                ? sourcePathResult.data
                : "")
            }
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

function useValRouterSourcePathFromCurrentPathname() {
  const schemas = useSchemas();
  const allModuleFilePaths =
    "data" in schemas && schemas.data
      ? (Object.keys(schemas.data) as ModuleFilePath[])
      : [];
  const maybeRecordSources = useShallowModulesAtPaths(
    allModuleFilePaths,
    "record",
  );
  const [currentPathname, setCurrentPathname] = useState<string | null>(null);
  useEffect(() => {
    setCurrentPathname(window.location.pathname);
    const listener = () => {
      setCurrentPathname(window.location.pathname);
    };
    window.addEventListener("popstate", listener);
    return () => {
      window.removeEventListener("popstate", listener);
    };
  }, []);
  const sourcePathResult = useMemo(() => {
    if (currentPathname) {
      for (const shallowModuleSource of maybeRecordSources.data || []) {
        for (const [fullPath, sourcePath] of Object.entries(
          shallowModuleSource,
        )) {
          if (fullPath === currentPathname) {
            const [moduleFilePath] =
              Internal.splitModuleFilePathAndModulePath(sourcePath);
            const schemasData =
              "data" in schemas ? schemas.data[moduleFilePath] : undefined;
            if (
              schemasData?.type === "record" &&
              schemasData.router !== undefined
            ) {
              return {
                status: "success",
                data: Internal.joinModuleFilePathAndModulePath(
                  moduleFilePath,
                  JSON.stringify(fullPath) as ModulePath,
                ),
              };
            }
          }
        }
      }
    }
    return {
      status: "not-found",
    };
  }, [schemas, maybeRecordSources, currentPathname]);
  return sourcePathResult;
}

const MenuButton = React.forwardRef<
  HTMLButtonElement | HTMLAnchorElement,
  {
    icon: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    label?: string;
    href?: string;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  } & React.HTMLAttributes<HTMLButtonElement | HTMLAnchorElement>
>(
  (
    {
      icon,
      onClick,
      disabled,
      active,
      label,
      href,
      onMouseEnter,
      onMouseLeave,
      ...rest
    },
    ref,
  ) => {
    const sharedClassName = classNames(buttonClassName, {
      "inline-block leading-4 bg-bg-brand-primary text-fg-brand-primary border-border-brand-primary hover:bg-bg-brand-primary-hover hover:text-fg-brand-primary":
        active,
      [classNames(buttonInactiveClassName, "inline-block leading-4")]: !active,
    });

    if (href) {
      return (
        <a
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          className={sharedClassName}
          onClick={onClick}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
          aria-label={label}
          title={label}
          {...rest}
        >
          {icon}
        </a>
      );
    }

    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        disabled={disabled}
        className={sharedClassName}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        aria-label={label}
        title={label}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);
MenuButton.displayName = "MenuButton";

function DraggableValMenu(props: ValMenuProps) {
  const [isDragging, setIsDragging] = useState(false);
  const { dropZone, setDropZone } = props;
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
          <ValMenu {...props} dropZone={dropZone} />
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
              <ValMenu ghost {...props} dropZone={dragOverDropZone} />
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

function maxRect(
  rect: { top: number; left: number; width: number; height: number },
  viewport: { top: number; left: number; width: number; height: number },
  strokeWidth: number,
) {
  // Calculate the rect with stroke
  const rectTop = rect.top - strokeWidth;
  const rectLeft = rect.left - strokeWidth;
  const rectWidth = rect.width + strokeWidth * 2;
  const rectHeight = rect.height + strokeWidth * 2;

  // Clip to viewport bounds
  const clippedTop = Math.max(viewport.top, rectTop);
  const clippedLeft = Math.max(viewport.left, rectLeft);
  const clippedRight = Math.min(
    viewport.left + viewport.width,
    rectLeft + rectWidth,
  );
  const clippedBottom = Math.min(
    viewport.top + viewport.height,
    rectTop + rectHeight,
  );

  return {
    top: clippedTop,
    left: clippedLeft,
    width: Math.max(0, clippedRight - clippedLeft),
    height: Math.max(0, clippedBottom - clippedTop),
  };
}
