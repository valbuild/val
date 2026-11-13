import classNames from "classnames";
import {
  Ellipsis,
  ExternalLink,
  Eye,
  Globe,
  GripHorizontal,
  LogIn,
  PanelsTopLeft,
  X,
} from "lucide-react";
import React, {
  Dispatch,
  SetStateAction,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
} from "@valbuild/core";
import { Button } from "./designSystem/button";
import { AnyField } from "./AnyField";
import {
  useAuthenticationState,
  useCurrentPatchIds,
  useValMode,
  useSiteHandoffState,
  useShallowModulesAtPaths,
  usePublishJobsState,
} from "./ValProvider";
import { ownPublishCard } from "../publish/ownPublishCard";
import { useAllValidationErrors } from "./ValErrorProvider";
import { useSchemaAtPath, useValConfig, useSchemas } from "./ValFieldProvider";
import { useAssistantAvailability } from "../hooks/useAssistantAvailability";
import { EnableAssistantPrompt } from "./EnableAssistantPrompt";
import { useTheme } from "./ValThemeProvider";
import { useValPortal } from "./ValPortalProvider";
import { FieldLoading } from "./FieldLoading";
import { urlOf, VAL_AI_SESSION_STORAGE_KEY } from "@valbuild/shared/internal";
import { Popover, PopoverContent } from "./designSystem/popover";
import { PopoverTrigger } from "@radix-ui/react-popover";
import { CodeChangedCard } from "./shell/CodeChangedCard";
import { PublishHandoffCard } from "./shell/PublishHandoff";
import { AnimatedClock } from "./AnimatedClock";
import { cn } from "./designSystem/cn";
import { OverlayMenuDivider, OverlayMenuLauncher } from "./shell/OverlayMenu";
import { OverlayMenuDock } from "./shell/OverlayMenuDock";
import { OverlaySettingsPanel } from "./shell/OverlaySettingsPanel";
import {
  DEFAULT_OVERLAY_PLACEMENT,
  LEGACY_STORAGE_KEY,
  OverlayPlacement,
  PLACEMENT_STORAGE_KEY,
  legacyDropZoneOf,
  parseStoredPlacement,
  placementOrientation,
} from "./shell/overlayPlacement";
import { ValLogo } from "./shell/ValLogo";
import {
  useLockBodyScroll,
  useVisualViewport,
} from "./shell/useVisualViewport";
import { AIChat } from "./AIChat";
import type { AIChatHandle } from "./AIChat";
import { useAI } from "../hooks/useAI";
import { useAIChatActions } from "./AIChatActionsContext";

export type ValOverlayProps = {
  draftMode: boolean;
  draftModeLoading: boolean;
  /**
   * Modules the page could not show the Studio's content of, because it was
   * made with another schema than the page's build has: the page shows its
   * own for them, and the overlay says so with a reload (`CodeChangedCard`).
   */
  codeChanged?: readonly ModuleFilePath[];
  setDraftMode: (draftMode: boolean) => void;
  disableOverlay: () => void;
};

/**
 * Holds the overlay's "born" AI chat session id so that the studio-link
 * sites (top menu, WindowField) can append `?session=` to their hrefs.
 * Null until the user has actually used the chat (sent a message or
 * uploaded an attachment) — matches the unborn/born model in useAI.
 */
const OverlaySessionContext = createContext<{
  bornSessionId: string | null;
  setBornSessionId: (id: string | null) => void;
}>({ bornSessionId: null, setBornSessionId: () => {} });

function appendSessionParam(base: string, sid: string | null): string {
  if (!sid) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}session=${encodeURIComponent(sid)}`;
}

type ValMenuProps = ValOverlayProps & {
  setMode: Dispatch<SetStateAction<OverlayModes>>;
  mode: OverlayModes;
  loading: boolean;
  placement: OverlayPlacement;
  setPlacement: (placement: OverlayPlacement) => void;
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
  isChatOpen: boolean;
  setIsChatOpen: Dispatch<SetStateAction<boolean>>;
};
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
  const [isChatOpen, setIsChatOpen] = useState(false);
  // The overlay's "born" chat session id is mirrored to sessionStorage so it
  // survives a host page reload and so other consumers (e.g. studio links
  // generated from inside the overlay) keep working after reload.
  const [bornSessionId, setBornSessionIdState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(VAL_AI_SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const setBornSessionId = useCallback((id: string | null) => {
    setBornSessionIdState(id);
    try {
      if (id == null) sessionStorage.removeItem(VAL_AI_SESSION_STORAGE_KEY);
      else sessionStorage.setItem(VAL_AI_SESSION_STORAGE_KEY, id);
    } catch {
      // sessionStorage may be disabled (private mode, quota) — fall back to
      // React-state-only behavior.
    }
  }, []);
  useEffect(() => {
    if (!props.draftMode) {
      setMode(null);
      setEditMode(null);
      setBoundingBox(null);
      setShowAllBoundingBoxes(false);
      setAllBoundingBoxesVisible(false);
      setAllBoundingBoxes([]);
      setIsChatOpen(false);
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
        /**
         * Set unconditionally, `null` included.
         *
         * `null` is the answer whenever the pointer is over nothing Val
         * tracks, and it has to be written: this used to set only when it
         * found something, so the box stayed parked over the last piece of
         * content the pointer crossed for as long as select mode was on. That
         * box is the thing that turns a click into "edit this" — it sits above
         * the page and stops the event — so whatever the page had at those
         * coordinates stopped responding, and a link under it could not be
         * followed. The stale outline looked like a rendering quirk; the dead
         * link underneath was the real cost.
         */
        setBoundingBox(boundingBox);
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

  /*
   * `theme` as well as `resolvedTheme`: `theme === null` still means "nothing
   * has said what mode this is yet", which is what the menu shows its loading
   * state for. `resolvedTheme` is never null, because it is what gets stamped.
   */
  const { theme, resolvedTheme, themeStyle } = useTheme();
  const [placement, setPlacementRaw] = useState<OverlayPlacement | null>(null);
  const config = useValConfig();
  const projectKey =
    PLACEMENT_STORAGE_KEY + "-" + (config?.project || "unknown");
  useEffect(() => {
    try {
      /*
       * The project's own first, then whatever was used last anywhere. Each
       * is read in its current form, then as the dock name it was stored as
       * before the menu could be dragged freely, so nobody's menu moves on
       * upgrade.
       */
      const stored =
        (config && parseStoredPlacement(localStorage.getItem(projectKey))) ||
        parseStoredPlacement(localStorage.getItem(PLACEMENT_STORAGE_KEY)) ||
        (config &&
          parseStoredPlacement(
            localStorage.getItem(
              "val-menu-drop-zone-" + (config?.project || "unknown"),
            ),
          )) ||
        parseStoredPlacement(localStorage.getItem(LEGACY_STORAGE_KEY));
      setPlacementRaw(stored ?? DEFAULT_OVERLAY_PLACEMENT);
    } catch (e) {
      Internal.log.debug("Error getting menu placement from local storage", e);
      setPlacementRaw(DEFAULT_OVERLAY_PLACEMENT);
    }
  }, [config, projectKey]);
  const setPlacement = useCallback(
    (next: OverlayPlacement) => {
      setPlacementRaw(next);
      try {
        const json = JSON.stringify(next);
        localStorage.setItem(projectKey, json);
        localStorage.setItem(PLACEMENT_STORAGE_KEY, json);
        // The framework packages draw a loading circle before the Studio has
        // loaded, and know only the eight docks.
        localStorage.setItem(LEGACY_STORAGE_KEY, legacyDropZoneOf(next));
      } catch (e) {
        Internal.log.debug("Error setting menu placement to local storage", e);
      }
    },
    [projectKey],
  );

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
    <OverlaySessionContext.Provider value={{ bornSessionId, setBornSessionId }}>
      <div
        data-mode={resolvedTheme}
        /*
         * The theme travels with `data-mode`, and this realm is the one where
         * it matters most: the outlines the canvas draws around editable
         * elements are `--bg-page-selection*`, which the accent moves.
         */
        style={themeStyle}
        id="val-overlay-container"
      >
        <Window
          editMode={editMode}
          setMode={setMode}
          setEditMode={setEditMode}
        />
        {boundingBox && (
          <div
            className={cn(
              "absolute z-[8998]",
              "cursor-pointer",
              "rounded-sm",
              "transition-all duration-150 ease-in-out",
              "border-2 border-bg-page-selection bg-bg-page-selection-fill",
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
                "border-2 border-bg-page-selection",
                "transition-opacity duration-200 ease-out",
                allBoundingBoxesVisible ? "opacity-70" : "opacity-0",
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
        <ChatWindow
          isOpen={isChatOpen && props.draftMode}
          onClose={() => setIsChatOpen(false)}
          onOpen={() => setIsChatOpen(true)}
        />
        {editMode === null && placement !== null && (
          <ValMenu
            {...props}
            mode={mode}
            setMode={setMode}
            loading={theme === null}
            placement={placement}
            setPlacement={setPlacement}
            findAllValPathElements={findAllValPathElements}
            setAllBoundingBoxes={setAllBoundingBoxes}
            setShowAllBoundingBoxes={setShowAllBoundingBoxes}
            setAllBoundingBoxesVisible={setAllBoundingBoxesVisible}
            isChatOpen={isChatOpen}
            setIsChatOpen={setIsChatOpen}
          />
        )}
      </div>
    </OverlaySessionContext.Provider>
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
  const { bornSessionId } = useContext(OverlaySessionContext);
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
  const visualViewport = useVisualViewport(isMobile);
  // Stop the user's page scrolling behind a full-screen sheet — on iOS
  // that also drags the visual viewport around.
  useLockBodyScroll(isMobile && editMode !== null);
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
      className={classNames(
        "fixed top-0 left-0",
        isMobile ? "z-[9001]" : "z-[8998]",
        {
          hidden: editMode === null,
          "opacity-100 w-[200svw] h-[100svh]": editMode !== null && !isMobile,
          "opacity-100 w-[100vw] h-[100svh]": editMode !== null && isMobile,
        },
      )}
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
          "flex flex-col bg-bg-float text-fg-primary",
          isMobile
            ? "fixed inset-x-0 border-0 rounded-none"
            : "absolute rounded-lg border border-border-float shadow-xl",
        )}
        ref={ref}
        style={
          isMobile
            ? // Pinned to the visual viewport, not the layout viewport: with
              // the keyboard up those are different rectangles and only this
              // one is the part of the screen the user can see.
              { top: visualViewport.offsetTop, height: visualViewport.height }
            : {
                top: windowPos.y,
                left: windowPos.x,
                ...(windowSize.width > 0
                  ? { width: windowSize.width, height: windowSize.height }
                  : { maxWidth: "640px" }),
              }
        }
      >
        {/* Header bar - for dragging on desktop, shows close button on mobile */}
        <div
          className={classNames(
            "grid grid-cols-3 items-center px-4 h-11 border-b border-border-float rounded-t-lg",
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
          <div className="text-[0.8125rem] font-semibold tracking-tight text-fg-primary">
            Edit content
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
                className="grid place-items-center w-7 h-7 rounded-md text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary transition-colors"
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
                    href={appendSessionParam(
                      window.origin +
                        "/val/~" +
                        Internal.splitJoinedSourcePaths(
                          editMode.joinedPaths,
                        )[0],
                      bornSessionId,
                    )}
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

function ChatWindow({
  isOpen,
  onClose,
  onOpen,
}: {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}) {
  const assistant = useAssistantAvailability();
  const chatRef = useRef<AIChatHandle | null>(null);
  const { chatEditorRef, setOpenAIChatImpl } = useAIChatActions();
  useEffect(() => {
    setOpenAIChatImpl(onOpen);
    return () => setOpenAIChatImpl(null);
  }, [onOpen, setOpenAIChatImpl]);
  const { bornSessionId, setBornSessionId } = useContext(OverlaySessionContext);
  // Capture the seeded-from-sessionStorage value once so later state changes
  // don't re-trigger useAI's mount-load effect. This is how a user coming
  // back from the studio (with an active session) sees the chat rehydrate
  // in the overlay.
  const initialBornSessionIdRef = useRef(bornSessionId);
  const {
    sendMessage,
    uploadAiImage,
    isConnected,
    authError,
    newSession,
    sessions,
    currentSessionId,
    getSessions,
    setSessionName,
    loadSession,
    isLoadingSession,
    answerToolQuestions,
    cancelToolQuestion,
    enableCodeMode,
    declineCodeMode,
  } = useAI(chatRef, {
    initialSessionId: initialBornSessionIdRef.current,
    onSessionBorn: setBornSessionId,
    onSessionCleared: () => setBornSessionId(null),
  });
  const mode = useValMode();
  const [windowPos, setWindowPos] = useState({
    x: Math.max(20, window.innerWidth - 570),
    y: 80,
  });
  const [windowSize, setWindowSize] = useState({ width: 480, height: 600 });
  const [windowInnerWidth, setWindowInnerWidth] = useState(window.innerWidth);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState<"se" | "e" | "s" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = windowInnerWidth < 1024;
  const visualViewport = useVisualViewport(isMobile);
  // Stop the user's page scrolling behind a full-screen sheet — on iOS
  // that also drags the visual viewport around.
  useLockBodyScroll(isMobile && isOpen);

  useEffect(() => {
    const handleResize = () => {
      setWindowInnerWidth(window.innerWidth);
      if (window.innerWidth < 1024) {
        setWindowPos({ x: 16, y: 16 });
      } else {
        setWindowPos((pos) => {
          const minVisible = 100;
          const maxX = window.innerWidth - minVisible;
          const maxY = window.innerHeight - minVisible;
          return {
            x: Math.max(
              -(windowSize.width - minVisible),
              Math.min(maxX, pos.x),
            ),
            y: Math.max(0, Math.min(maxY, pos.y)),
          };
        });
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [windowSize.width]);

  useEffect(() => {
    if (isDragging && !isMobile) {
      const handleMove = (ev: MouseEvent) => {
        setWindowPos((pos) => {
          const minVisible = 100;
          const maxX = window.innerWidth - minVisible;
          const maxY = window.innerHeight - minVisible;
          const w = ref.current?.offsetWidth ?? windowSize.width;
          return {
            x: Math.max(
              -(w - minVisible),
              Math.min(maxX, pos.x + ev.movementX),
            ),
            y: Math.max(0, Math.min(maxY, pos.y + ev.movementY)),
          };
        });
      };
      const handleMoveEnd = () => setIsDragging(false);
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleMoveEnd);
      return () => {
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleMoveEnd);
      };
    }
  }, [isDragging, isMobile, windowSize.width]);

  useEffect(() => {
    if (isResizing && !isMobile) {
      const handleResize = (ev: MouseEvent) => {
        const minWidth = 360;
        const minHeight = 400;
        if (isResizing === "se" || isResizing === "e") {
          setWindowSize((size) => ({
            ...size,
            width: Math.max(
              minWidth,
              Math.min(
                window.innerWidth - windowPos.x - 20,
                size.width + ev.movementX,
              ),
            ),
          }));
        }
        if (isResizing === "se" || isResizing === "s") {
          setWindowSize((size) => ({
            ...size,
            height: Math.max(
              minHeight,
              Math.min(
                window.innerHeight - windowPos.y - 20,
                size.height + ev.movementY,
              ),
            ),
          }));
        }
      };
      const handleResizeEnd = () => setIsResizing(null);
      window.addEventListener("mousemove", handleResize);
      window.addEventListener("mouseup", handleResizeEnd);
      return () => {
        window.removeEventListener("mousemove", handleResize);
        window.removeEventListener("mouseup", handleResizeEnd);
      };
    }
  }, [isResizing, isMobile, windowPos.x, windowPos.y]);

  return (
    <div
      className={cn("fixed top-0 left-0", isMobile ? "z-[9001]" : "z-[8999]")}
      style={!isOpen ? { display: "none" } : undefined}
    >
      <div
        className={classNames(
          "flex flex-col bg-bg-float text-fg-primary",
          isMobile
            ? "fixed inset-x-0 border-0 rounded-none"
            : "absolute rounded-lg border border-border-float shadow-xl",
        )}
        ref={ref}
        style={
          isMobile
            ? // See the edit window: with the keyboard open the chat input has
              // to sit above it, which only the visual viewport can tell us.
              { top: visualViewport.offsetTop, height: visualViewport.height }
            : {
                top: windowPos.y,
                left: windowPos.x,
                width: windowSize.width,
                height: windowSize.height,
              }
        }
      >
        <div
          className={classNames(
            "grid grid-cols-3 items-center px-4 h-11 border-b border-border-float rounded-t-lg",
            { "cursor-grab active:cursor-grabbing": !isMobile },
          )}
          onMouseDown={(ev) => {
            if (!isMobile) {
              ev.preventDefault();
              setIsDragging(true);
            }
          }}
        >
          <div className="text-[0.8125rem] font-semibold tracking-tight text-fg-primary">
            AI assistant
          </div>
          <div className="flex justify-center">
            {!isMobile && (
              <GripHorizontal size={16} className="text-fg-secondary" />
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-bg-secondary transition-colors"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          {/*
            The same offer the Studio's panel makes, for the same reason: this
            window is reachable while nobody has said whether the project has an
            assistant, and it must ask rather than open a chat that cannot send.
          */}
          {assistant === "unconfigured" ? (
            <EnableAssistantPrompt />
          ) : (
            <AIChat
              ref={chatRef}
              chatEditorRef={chatEditorRef}
              onSendMessage={sendMessage}
              onUploadFile={uploadAiImage}
              onNewSession={newSession}
              isConnected={isConnected}
              authError={authError}
              mode={mode}
              sessions={sessions}
              currentSessionId={currentSessionId}
              onLoadSession={loadSession}
              onFetchSessions={getSessions}
              onSetSessionName={setSessionName}
              isLoadingSession={isLoadingSession}
              onAnswerToolQuestions={answerToolQuestions}
              onCancelToolQuestion={cancelToolQuestion}
              onEnableCodeMode={enableCodeMode}
              onDeclineCodeMode={declineCodeMode}
            />
          )}
        </div>
        {!isMobile && (
          <>
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-bg-brand-primary/50 transition-colors"
              onMouseDown={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setIsResizing("e");
              }}
            />
            <div
              className="absolute bottom-0 left-0 w-full h-1 cursor-ns-resize hover:bg-bg-brand-primary/50 transition-colors"
              onMouseDown={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setIsResizing("s");
              }}
            />
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

// inline-flex + centering (rather than inline-block) so every button in the
// menu is exactly icon + padding + border tall: an inline icon sits on the text
// baseline, which adds descender space that varies with the inherited
// line-height and makes the buttons different heights
// Kept in step with OverlayMenuButton: the overlay's own buttons and the ones
// rendered inside its windows have to look like the same control.
const buttonClassName =
  "inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors disabled:text-fg-disabled disabled:pointer-events-none";
const buttonInactiveClassName =
  "text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary";

function WindowField({
  path: path,
  showInlineStudioLink,
}: {
  path: SourcePath;
  showInlineStudioLink: boolean;
}) {
  const schemaAtPath = useSchemaAtPath(path);
  const { bornSessionId } = useContext(OverlaySessionContext);
  const studioUrl = appendSessionParam(
    window.origin + "/val/~" + path,
    bornSessionId,
  );

  if (schemaAtPath.status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-fg-error-on-surface text-sm">
          {schemaAtPath.error}
        </div>
      </div>
    );
  }
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
            {schemaAtPath.data.description && (
              <div className="pb-2 text-sm text-fg-tertiary">
                {schemaAtPath.data.description}
              </div>
            )}
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
      {schemaAtPath.data.description && (
        <div className="text-sm text-fg-tertiary">
          {schemaAtPath.data.description}
        </div>
      )}
      <AnyField path={path} schema={schemaAtPath.data} autoFocus={true} />
    </div>
  );
}

/** The side of a menu button that faces into the page, for its popovers. */
function sideFacingPage(
  placement: OverlayPlacement,
): "top" | "right" | "bottom" | "left" {
  switch (placement.edge) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "top":
      return "bottom";
    case "bottom":
      return "top";
  }
}

/**
 * The "⋯" menu: where the menu sits, light or dark, and leaving preview mode.
 */
function OverlaySettings({
  placement,
  onPlacementChange,
  draftMode,
  draftModeLoading,
  setDraftMode,
  side,
  open,
  onOpenChange,
}: {
  placement: OverlayPlacement;
  onPlacementChange: (placement: OverlayPlacement) => void;
  draftMode: boolean;
  draftModeLoading: boolean;
  setDraftMode: (draftMode: boolean) => void;
  side: "top" | "right" | "bottom" | "left";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const portalContainer = useValPortal();
  /*
   * `resolvedTheme`, so the switch shows the mode that is on screen. `theme`
   * can still be null here — nobody has chosen — while the project's own
   * default from `s.settings()` is what is being drawn.
   */
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        aria-label="More"
        title="More"
        className={classNames(buttonClassName, buttonInactiveClassName, {
          "bg-bg-float-raised text-fg-primary": open,
        })}
      >
        <Ellipsis size={16} />
      </PopoverTrigger>
      <PopoverContent
        side={side}
        sideOffset={10}
        container={portalContainer}
        className="z-[9003] w-60 p-1.5"
      >
        <OverlaySettingsPanel
          placement={placement}
          onPlacementChange={onPlacementChange}
          dark={resolvedTheme === "dark"}
          onDarkChange={(dark) => setTheme(dark ? "dark" : "light")}
          inPreview={draftMode}
          exitingPreview={draftModeLoading}
          onExitPreview={() => {
            onOpenChange(false);
            setDraftMode(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The menu over the user's page.
 *
 * Kept to what is worth a button on someone else's design: select something
 * to edit it, publish, go to the Studio, and the assistant where there is
 * one. Everything else is in "⋯" — where it sits, light or dark, leaving
 * preview mode, and hiding Val — because those are things done once, not
 * while editing. Out of preview mode it is the way back in, the Studio and
 * the same "⋯".
 *
 * ONE launcher for both modes. It used to be two, each in an `AnimateHeight`,
 * cross-fading their heights when preview mode changed — under a menu that
 * was itself animating its length — which is a large part of why it moved
 * oddly.
 */
function ValMenu({
  placement,
  setPlacement,
  draftMode,
  draftModeLoading,
  setDraftMode,
  disableOverlay,
  loading,
  codeChanged = [],
}: ValMenuProps) {
  const { bornSessionId } = useContext(OverlaySessionContext);
  const authenticationState = useAuthenticationState();
  // The "⋯" menu holds the bar open: it is portalled out of the bar, so
  // using it is leaving the bar.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const patchIds = useCurrentPatchIds();
  const validationErrors = useAllValidationErrors() || {};
  const validationErrorCount = Object.keys(validationErrors).length;
  const sourcePathResult = useValRouterSourcePathFromCurrentPathname();
  const handoff = useSiteHandoffState();
  /*
   * A publish this page made itself -- one of content alone, which opens no
   * builder tab -- has no tab's card to follow it, so it gets one of its own.
   */
  const publishJobsState = usePublishJobsState();
  const [dismissedPublishes, setDismissedPublishes] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const own =
    handoff.state === null
      ? ownPublishCard(publishJobsState, dismissedPublishes)
      : null;
  const popoverSide = sideFacingPage(placement);
  // Collapsed, the circle still has to say whether there is work outstanding.
  const launcherStatus: "none" | "changes" | "errors" =
    validationErrorCount > 0
      ? "errors"
      : patchIds.length > 0
        ? "changes"
        : "none";
  const inPreview = draftMode && !draftModeLoading;
  const pageInStudio =
    sourcePathResult.status === "success" && sourcePathResult.data
      ? sourcePathResult.data
      : "";
  const studioHref = appendSessionParam(
    window.origin + "/val/~" + pageInStudio,
    bornSessionId,
  );
  const studioIcon = pageInStudio ? (
    <Globe size={16} />
  ) : (
    <PanelsTopLeft size={16} />
  );
  const settings = (
    <OverlaySettings
      placement={placement}
      onPlacementChange={setPlacement}
      draftMode={draftMode}
      draftModeLoading={draftModeLoading}
      setDraftMode={setDraftMode}
      side={popoverSide}
      open={settingsOpen}
      onOpenChange={setSettingsOpen}
    />
  );
  return (
    <>
      {codeChanged.length > 0 && (
        <div className={handoffCardPositionClassName(placement)}>
          <CodeChangedCard
            modules={codeChanged}
            onReload={() => window.location.reload()}
          />
        </div>
      )}
      {handoff.state !== null && (
        /*
         * A publish handed to a Studio tab, because this page cannot build.
         * Beside the dock rather than in a window: it is news about something
         * happening elsewhere, and editing carries on under it.
         */
        <div className={handoffCardPositionClassName(placement)}>
          <PublishHandoffCard
            state={handoff.state}
            onReload={() => window.location.reload()}
            onOpenStudio={handoff.openStudio}
            onDismiss={
              handoff.state.kind === "opening" ||
              handoff.state.kind === "running"
                ? undefined
                : handoff.dismiss
            }
          />
        </div>
      )}
      {own !== null && (
        <div className={handoffCardPositionClassName(placement)}>
          <PublishHandoffCard
            state={own.card}
            onReload={() => window.location.reload()}
            onBuildInTab={() => {
              // In the tap: only a tap may open a tab. It presses the same
              // request again, finds it pressed, and builds its job.
              handoff.prepare(true, {
                requestId: own.requestId,
                after: null,
              });
            }}
            onDismiss={
              own.card.kind === "publishing"
                ? undefined
                : () =>
                    setDismissedPublishes(
                      (prev) => new Set([...prev, own.requestId]),
                    )
            }
          />
        </div>
      )}
      <OverlayMenuDock
        placement={placement}
        onPlacementChange={setPlacement}
        className="z-[8999]"
      >
        {({ dragging }) =>
          // See ValNextProvider: the same circle is drawn there while the
          // Studio loads, so the menu does not appear from nowhere.
          loading ? (
            <div className="grid place-items-center w-[42px] h-[42px] rounded-full bg-bg-float border border-border-float text-fg-primary shadow-lg">
              <AnimatedClock size={16} />
            </div>
          ) : authenticationState === "login-required" ? (
            <a
              href={urlOf("/api/val/authorize", {
                redirect_to: window.location.href,
              })}
              aria-label="Sign in to Val"
              title="Sign in to Val"
              className="grid place-items-center w-[42px] h-[42px] rounded-full bg-bg-float border border-border-float text-fg-primary shadow-lg hover:bg-bg-float-raised"
            >
              <LogIn size={16} />
            </a>
          ) : (
            <OverlayMenuLauncher
              placement={placement}
              dragging={dragging}
              status={launcherStatus}
              mark={<ValMark />}
              holdOpen={settingsOpen}
            >
              {!inPreview && (
                <MenuButton
                  label="Enable preview mode"
                  disabled={draftModeLoading}
                  icon={
                    draftModeLoading ? (
                      <AnimatedClock size={16} />
                    ) : (
                      <Eye size={16} />
                    )
                  }
                  onClick={() => {
                    setDraftMode(true);
                  }}
                />
              )}
              <MenuButton
                label={
                  validationErrorCount > 0
                    ? `Open in Studio (${validationErrorCount} validation error${validationErrorCount === 1 ? "" : "s"})`
                    : patchIds.length > 0
                      ? `Open in Studio (${patchIds.length} pending change${patchIds.length === 1 ? "" : "s"})`
                      : "Open in Studio"
                }
                href={studioHref}
                icon={
                  // flex, so the icon does not sit on a text baseline and
                  // make this button taller than the others
                  <div className="flex relative">
                    <PendingChangesBadge
                      patchCount={patchIds.length}
                      validationErrorCount={validationErrorCount}
                    />
                    {studioIcon}
                  </div>
                }
              />
              {settings}
              <OverlayMenuDivider
                orientation={placementOrientation(placement)}
              />
              <MenuButton
                label="Turn off Val on this site"
                icon={<X size={16} />}
                onClick={() => disableOverlay()}
              />
            </OverlayMenuLauncher>
          )
        }
      </OverlayMenuDock>
    </>
  );
}

/** The Val mark, sized for the collapsed launcher. */
function ValMark() {
  return <ValLogo className="h-6" />;
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
    const customEventListener = (event: Event) => {
      if (event instanceof CustomEvent) {
        if (
          typeof event.detail === "string" &&
          event.detail !== currentPathname
        ) {
          setCurrentPathname(event.detail);
        }
      }
    };
    window.addEventListener("val-provider:pathname", customEventListener);
    return () => {
      window.removeEventListener("popstate", listener);
      window.removeEventListener("val-provider:pathname", customEventListener);
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

/**
 * The counter on the compare button: how much there is to review. Shows the
 * number of validation errors in red when there are any, otherwise the number
 * of pending changes. Anything above 9 is shown as "9+" so the badge stays a
 * dot rather than growing with the count.
 *
 * Must be rendered inside a `relative` container.
 */
function PendingChangesBadge({
  patchCount,
  validationErrorCount,
}: {
  patchCount: number;
  validationErrorCount: number;
}) {
  const isError = validationErrorCount > 0;
  const count = isError ? validationErrorCount : patchCount;
  if (count === 0) {
    return null;
  }
  const noun = isError ? "validation error" : "pending change";
  return (
    <span
      aria-label={`${count} ${noun}${count === 1 ? "" : "s"}`}
      className={classNames(
        "absolute -top-2 -right-2 inline-flex justify-center items-center px-1 h-4 min-w-[1rem] text-[9px] font-medium leading-none rounded-full tabular-nums",
        // ring in the menu background color so the badge reads as a separate
        // dot on top of the button instead of blending into it
        "ring-2 ring-bg-float",
        {
          // A pending-change count is information, not a warning: it inverts to
          // the foreground colour rather than spending the brand hue on it.
          // Validation errors stay red, because they block publishing.
          "bg-fg-primary text-bg-float": !isError,
          "bg-bg-error-primary text-fg-error-primary": isError,
        },
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
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
      "bg-bg-float-raised text-fg-primary": active,
      [buttonInactiveClassName]: !active,
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

/**
 * Where the cards beside the menu sit: one step in from the edge the menu is
 * on, so they clear it wherever along that edge it is, and toward the same
 * end of the edge as the menu.
 */
function handoffCardPositionClassName(placement: OverlayPlacement): string {
  const base = "fixed z-[8999]";
  const third =
    placement.offset < 1 / 3
      ? "start"
      : placement.offset > 2 / 3
        ? "end"
        : "middle";
  switch (placement.edge) {
    case "left":
    case "right": {
      const across = placement.edge === "left" ? "left-20" : "right-20";
      const along =
        third === "start"
          ? "top-4"
          : third === "end"
            ? "bottom-4"
            : "top-1/2 -translate-y-1/2";
      return `${base} ${across} ${along}`;
    }
    case "top":
    case "bottom": {
      const across = placement.edge === "top" ? "top-20" : "bottom-20";
      const along =
        third === "start"
          ? "left-4"
          : third === "end"
            ? "right-4"
            : "left-1/2 -translate-x-1/2";
      return `${base} ${across} ${along}`;
    }
  }
}

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
