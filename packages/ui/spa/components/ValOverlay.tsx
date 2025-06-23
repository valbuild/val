import classNames from "classnames";
import {
  Clock,
  Ellipsis,
  Eye,
  EyeOff,
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
  useRef,
  useState,
} from "react";
import { AnimateHeight } from "./AnimateHeight";
import { Internal, SourcePath } from "@valbuild/core";
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
          if (el.tagName === "SOURCE" || el.tagName === "TRACK") {
            const sourceParentEl = el.parentElement;
            if (
              !sourceParentEl ||
              !(
                sourceParentEl.tagName === "VIDEO" ||
                sourceParentEl.tagName === "PICTURE" ||
                sourceParentEl.tagName === "AUDIO"
              )
            ) {
              return;
            }
            const rect = sourceParentEl.getBoundingClientRect();
            newBoundingBoxes.push({
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              joinedPaths: path,
            });
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
      {boundingBoxes.map((boundingBox, i) => {
        return (
          <div
            className="absolute top-0 border border-bg-brand-primary z-[8998] hover:border-2 rounded"
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
                className="absolute top-[0px] right-[0px] w-full truncate bg-bg-brand-primary text-text-brand-primary flex gap-2 px-2 rounded-bl hover:opacity-20 cursor-pointer"
                style={{
                  fontSize: `${Math.min(boundingBox.height - 2, 10)}px`,
                  maxHeight: `${Math.min(boundingBox.height - 2, 16)}px`,
                  maxWidth: `${Math.min(boundingBox.width - 2, 300)}px`,
                }}
              >
                {Internal.splitJoinedSourcePaths(boundingBox.joinedPaths).map(
                  (path) => {
                    const [moduleFilePath, modulePath] =
                      Internal.splitModuleFilePathAndModulePath(path);

                    return (
                      <ValPath
                        key={path}
                        link={false}
                        toolTip={false}
                        moduleFilePath={moduleFilePath}
                        patchPath={Internal.splitModulePath(modulePath)}
                      />
                    );
                  },
                )}
              </div>
            </div>
          </div>
        );
      })}
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
          "absolute grid grid-cols-[32px,1fr,32px] rounded bg-bg-primary text-text-primary cursor-pointer",
          {
            "w-[calc(100vw-32px)] h-[calc(100svh-32px)]":
              windowInnerWidth < 1024,
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
            className="flex flex-col gap-4 justify-start items-start w-full lg:justify-start"
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
  return (
    <div className="right-16 p-4">
      {/* See ValNextProvider: this same snippet is used there  */}
      {loading && (
        <div className={getPositionClassName(dropZone) + " p-4"}>
          <div className="flex justify-center items-center p-2 text-white bg-black rounded backdrop-blur">
            <Clock className="animate-spin" size={16} />
          </div>
        </div>
      )}
      {authenticationState === "login-required" && (
        <div className={getPositionClassName(dropZone) + " p-4"}>
          <div className="flex justify-center items-center p-2 text-white bg-black rounded backdrop-blur">
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
            "flex relative rounded bg-bg-primary border border-border-primary text-text-primary gap-2",
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
                <Clock size={16} className="animate-spin" />
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
              className={classNames("p-2 rounded-full disabled:bg-bg-disabled")}
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
                              "bg-bg-error-primary text-text-error-primary":
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
                  <div className="p-2 rounded bg-bg-primary text-text-primary">
                    {validationErrorCount > 0 && (
                      <div className="text-text-error-primary">
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
                <div className="flex gap-4 justify-between items-center px-4 py-4 pt-8 sm:hidden">
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
            icon={<PanelsTopLeft size={16} />}
            onClick={() => {
              window.location.href = window.origin + "/val/~";
            }}
          />
          <Popover>
            <PopoverTrigger
              className={classNames("p-2 rounded-full disabled:bg-bg-disabled")}
            >
              <Ellipsis size={16} />
            </PopoverTrigger>
            <PopoverContent container={portalContainer} className="z-[9003]">
              <div className="grid grid-cols-[1fr,auto] gap-2">
                <span>Dock to top</span>
                <button
                  onClick={() => {
                    setDropZone("val-menu-center-top");
                  }}
                >
                  <PanelTop size={16} />
                </button>
                <span>Dock to right</span>
                <button
                  onClick={() => {
                    setDropZone("val-menu-right-center");
                  }}
                >
                  <PanelRight size={16} />
                </button>
                <span>Dock to left</span>
                <button
                  onClick={() => {
                    setDropZone("val-menu-left-center");
                  }}
                >
                  <PanelLeft size={16} />
                </button>
                <span>Dock to bottom</span>
                <button
                  onClick={() => {
                    setDropZone("val-menu-center-bottom");
                  }}
                >
                  <PanelBottom size={16} />
                </button>
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
            "flex relative rounded bg-bg-primary text-text-primary gap-2 justify-center items-center",
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
              draftModeLoading ? (
                <Clock size={16} className="animate-spin" />
              ) : (
                <Eye size={16} />
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
        "text-bg-brand-primary": !!active,
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
