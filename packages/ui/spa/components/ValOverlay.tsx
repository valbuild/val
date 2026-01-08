import classNames from "classnames";
import {
  Ellipsis,
  Eye,
  EyeOff,
  Globe,
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
import {
  Dispatch,
  Fragment,
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
import { HoverCard } from "./designSystem/hover-card";
import { HoverCardContent, HoverCardTrigger } from "@radix-ui/react-hover-card";
import { PublishButton } from "./PublishButton";
import { ScrollArea } from "./designSystem/scroll-area";
import { ValPath } from "./ValPath";
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
  useEffect(() => {
    if (!props.draftMode) {
      setMode(null);
      setEditMode(null);
      setBoundingBox(null);
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
              boundingBox = {
                top: el.offsetTop,
                left: el.offsetLeft,
                width: el.offsetWidth,
                height: el.offsetHeight,
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
      };
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
  }, [config?.project || "unknown"]);
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
              top: window.innerHeight,
              left: window.innerWidth,
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
      {editMode === null && (
        <DraggableValMenu
          {...props}
          mode={mode}
          setMode={setMode}
          loading={theme === null}
          dropZone={dropZone}
          setDropZone={setDropZone}
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
  const [windowInnerWidth, setWindowInnerWidth] = useState(window.innerWidth);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePosition = () => {
      if (editMode) {
        setTimeout(() => {
          if (ref.current) {
            const { innerWidth, innerHeight } = window;
            const { offsetWidth, offsetHeight } = ref.current;
            const height = offsetHeight;
            const width = offsetWidth;
            let newX = editMode.clientX;
            let newY = editMode.clientY;
            const padding = 80;
            const overflowX = innerWidth - (editMode.clientX + width);
            if (overflowX < 0) {
              newX = newX + (overflowX - padding);
            }
            const overflowY = innerHeight - (editMode.clientY + height);
            if (overflowY < 0) {
              newY = newY + (overflowY - padding);
            }
            setWindowPos({ x: newX, y: newY });
          }
        }, 100);
      } else {
        setWindowPos({ x: window.innerWidth, y: window.innerHeight });
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
      if (windowInnerWidth < 1024) {
        setWindowPos({ x: 16, y: 16 });
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
    if (isDragging) {
      const handleMove = (ev: MouseEvent | TouchEvent) => {
        if (ev instanceof MouseEvent) {
          setWindowPos((pos) => ({
            x: pos.x + ev.movementX,
            y: pos.y + ev.movementY,
          }));
        } else {
          const touch = ev.touches[0];
          setWindowPos(() => ({
            x: touch.clientX,
            y: touch.clientY,
          }));
        }
      };
      const handleMoveEnd = () => {
        setIsDragging(false);
      };
      const handleClick = () => {
        setIsDragging(false);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleMoveEnd);
      // window.addEventListener("touchmove", handleMove);
      // window.addEventListener("touchend", handleMoveEnd);
      window.addEventListener("click", handleClick);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleMoveEnd);
        // window.addEventListener("touchend", handleMoveEnd);
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
    <div
      className={classNames("fixed top-0 left-0 z-[8998]", {
        hidden: editMode === null,
        // 200vw to make sure we can drag the window all the way to the right:
        "opacity-100 w-[200svw] h-[100svh]": editMode !== null,
      })}
    >
      <div
        className={classNames("fixed top-0 left-0", {
          hidden: editMode === null,
          "opacity-100 w-[100vw] h-[100svh]": editMode !== null,
        })}
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
       * having the mouse down behaving weirdly if other buttons (navigate to path) where clicked.
       *
       * TODO: fix this
       */}
      <div
        className={classNames(
          "absolute grid grid-cols-[32px,1fr,32px] rounded bg-bg-primary text-fg-primary border-2 border-border-secondary",
          {
            "w-[calc(100vw-32px)] h-[calc(100svh-32px)]":
              windowInnerWidth < 1024,
            "min-w-[500px]": windowInnerWidth >= 1024,
          },
        )}
        ref={ref}
        style={{
          top: windowPos.y,
          left: windowPos.x,
        }}
      >
        <div
          className="cursor-grab"
          // onTouchStart={() => {
          //   setIsDragging(true);
          // }}
          onMouseDown={() => {
            setIsDragging(true);
          }}
        ></div>
        <div className="grid grid-rows-[32px,1fr,32px]">
          <div
            ref={ref}
            className="cursor-grab"
            // onTouchStart={() => {
            //   setIsDragging(true);
            // }}
            onMouseDown={() => {
              setIsDragging(true);
            }}
          ></div>
          <form
            className="flex flex-col items-start justify-start w-full gap-4 lg:justify-start"
            onSubmit={(ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              setMode("select");
              setEditMode(null);
            }}
          >
            {editMode &&
              Internal.splitJoinedSourcePaths(editMode.joinedPaths).map(
                (path) => {
                  const [moduleFilePath, modulePath] =
                    Internal.splitModuleFilePathAndModulePath(path);
                  const patchPath = Internal.splitModulePath(modulePath);
                  return (
                    <Fragment key={path}>
                      <ValPath
                        link
                        toolTip
                        moduleFilePath={moduleFilePath}
                        patchPath={patchPath}
                      />
                      <WindowField path={path} />
                    </Fragment>
                  );
                },
              )}
            <Button className="self-end" type="submit">
              Done
            </Button>
          </form>
          <div
            ref={ref}
            className="cursor-grab"
            // onTouchStart={() => {
            //   setIsDragging(true);
            // }}
            onMouseDown={() => {
              setIsDragging(true);
            }}
          ></div>
        </div>
        <div
          ref={ref}
          className="cursor-grab"
          // onTouchStart={() => {
          //   setIsDragging(true);
          // }}
          onMouseDown={() => {
            setIsDragging(true);
          }}
        ></div>
      </div>
    </div>
  );
}

const buttonClassName =
  "p-2 rounded-md disabled:bg-bg-disabled transition-colors border";
const buttonInactiveClassName = "hover:bg-bg-primary-hover border-bg-primary";

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
    <div className="flex flex-col gap-4 max-w-[600px] w-full">
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
          <MenuButton
            label="Disable preview mode"
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
          <div className="pb-1 mt-1 border-t border-border-primary"></div>
          <Popover>
            <PopoverTrigger
              disabled={publishDisabled}
              className={classNames(buttonClassName, buttonInactiveClassName)}
            >
              <HoverCard>
                <HoverCardTrigger>
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
                <HoverCardContent>
                  <div className="p-2 rounded bg-bg-primary text-fg-primary">
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
                  </div>
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
                <span>Dark mode</span>
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
  }, ["data" in schemas && schemas.data, maybeRecordSources, currentPathname]);
  return sourcePathResult;
}

function MenuButton({
  icon,
  onClick,
  disabled,
  active,
  label,
  href,
}: {
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  label?: string;
  href?: string;
}) {
  const Comp = href ? "a" : "button";
  return (
    <Comp
      href={href}
      disabled={disabled}
      className={classNames(buttonClassName, {
        "bg-bg-brand-primary text-fg-brand-primary border-border-brand-primary hover:bg-bg-brand-primary-hover hover:text-fg-brand-primary":
          active,
        [buttonInactiveClassName]: !active,
      })}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {icon}
    </Comp>
  );
}

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
  max: { top: number; left: number; width: number; height: number },
  strokeWidth: number,
) {
  return {
    top: Math.max(0, rect.top - strokeWidth),
    left: Math.max(0, rect.left - strokeWidth),
    width: Math.min(max.width - rect.left, rect.width + strokeWidth * 2),
    height: Math.min(max.height - rect.top, rect.height + strokeWidth * 2),
  };
}
