import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Layers, ListTree, MessageSquare } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { useShellBreakpoint } from "../useShellBreakpoint";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { CanvasChat } from "./CanvasChat";
import { CanvasPage } from "./CanvasPage";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasViewport, clampScale, fitTransform } from "./CanvasViewport";
import { FieldsPanel } from "./FieldsPanel";
import {
  CANVAS_DEVICE_WIDTHS,
  CanvasChatAttachment,
  CanvasChatMessage,
  CanvasDevice,
  CanvasPageData,
  CanvasPane,
  CanvasTransform,
} from "./types";

/** Which arrangement the workspace is in. */
export type CanvasMode = "fields" | "canvas";

export type CanvasViewProps = {
  page: CanvasPageData;
  /** Arrangement to start in. */
  initialMode?: CanvasMode;
  initialChat?: CanvasChatMessage[];
  onExit?: () => void;
  /** Skips the entrance transition — for screenshots and for tests. */
  skipTransition?: boolean;
  /** Which pane a phone starts on. */
  initialPane?: CanvasPane;
  initialDevice?: CanvasDevice;
  initialSelectedFieldId?: string | null;
  initialAttachedFieldIds?: string[];
  isDevMode?: boolean;
};

/** How far the canvas starts scaled down when it animates in. */
const ENTER_SCALE = 0.96;
/** Width of the assistant, and of the fields rail beside the canvas. */
const CHAT_WIDTH = 320;
const RAIL_WIDTH = 300;
/** Width the fields list settles at when it is the whole workspace. */
const FIELDS_COLUMN_WIDTH = 760;
/** Long enough to follow the fields list across, short enough not to wait. */
const MODE_MS = 320;
const MODE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * The canvas view: the page on a pan/zoom canvas, its fields at the side, and
 * the assistant holding whatever you picked off it.
 *
 * Entering scales and fades the whole view up from slightly small, which
 * reads as stepping back from the page rather than as a new screen arriving.
 * Leaving reverses it, so the way out is the way in.
 *
 * On a phone the two halves become panes that snap horizontally — chat on the
 * left, canvas on the right — which is how Lovable does it, and it works
 * because at that width you are only ever using one of them.
 */
export function CanvasView({
  page: initialPage,
  initialMode = "canvas",
  initialChat = [],
  onExit,
  skipTransition,
  initialPane = "canvas",
  initialDevice = "desktop",
  initialSelectedFieldId = null,
  initialAttachedFieldIds = [],
  isDevMode,
}: CanvasViewProps) {
  const breakpoint = useShellBreakpoint();
  const isPhone = breakpoint === "mobile";
  const reducedMotion = usePrefersReducedMotion();
  /**
   * Transition for the named properties, or none if motion is unwelcome.
   *
   * Declared inline rather than with `transition-[…] duration-[…]` because a
   * `duration-[320ms]` utility was measured losing to the duration that
   * `transition-[…]` sets for itself, leaving the move at Tailwind's default
   * 150ms. Inline, the timing is unambiguous.
   */
  const ease = (properties: string[]) =>
    reducedMotion
      ? undefined
      : properties.map((p) => `${p} ${MODE_MS}ms ${MODE_EASE}`).join(", ");

  const [page, setPage] = useState(initialPage);
  const [device, setDevice] = useState<CanvasDevice>(initialDevice);
  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(
    initialSelectedFieldId,
  );
  const [attachedFieldIds, setAttachedFieldIds] = useState<string[]>(
    initialAttachedFieldIds,
  );
  const [isSelectMode, setIsSelectMode] = useState(true);
  const [chat, setChat] = useState<CanvasChatMessage[]>(initialChat);
  const [pane, setPane] = useState<CanvasPane>(initialPane);
  const [mode, setMode] = useState<CanvasMode>(initialMode);
  const [entered, setEntered] = useState(skipTransition === true);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const paneScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (skipTransition) return;
    // Next frame, so the browser has the pre-transition state to move from.
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, [skipTransition]);

  const pageWidth = CANVAS_DEVICE_WIDTHS[device];

  const fit = useCallback(() => {
    const viewport = viewportRef.current?.getBoundingClientRect();
    const height = pageRef.current?.offsetHeight;
    if (!viewport || !height) return;
    setTransform(
      fitTransform(
        { width: pageWidth, height },
        { width: viewport.width, height: viewport.height },
      ),
    );
  }, [pageWidth]);

  // Fitting needs the page's laid-out height, which is not known for a frame
  // or two after mount — measuring too early fits to a page a tenth of its
  // real size. A ResizeObserver waits for the height to actually arrive, and
  // the flag stops it re-fitting afterwards and fighting the user's zoom.
  const [needsFit, setNeedsFit] = useState(true);
  useEffect(() => {
    if (!needsFit) return;
    const pageEl = pageRef.current;
    const viewportEl = viewportRef.current;
    if (!pageEl || !viewportEl) return;
    const attempt = () => {
      if (pageEl.offsetHeight === 0 || viewportEl.clientHeight === 0) return;
      fit();
    };
    const observer = new ResizeObserver(attempt);
    observer.observe(pageEl);
    observer.observe(viewportEl);
    attempt();
    return () => observer.disconnect();
  }, [needsFit, fit]);

  // A device switch changes the layout under the zoom, so it re-fits. So does
  // arriving on the canvas, which has no width to fit into until it opens.
  useEffect(() => setNeedsFit(true), [device, mode]);

  // The moment the user pans or zooms, the view is theirs and refitting would
  // yank it back.
  const setTransformByUser = useCallback((next: CanvasTransform) => {
    setNeedsFit(false);
    setTransform(next);
  }, []);

  // The phone's panes are a scroll container, so moving between them is a
  // scroll — which keeps the swipe and the button doing the same thing.
  useEffect(() => {
    if (!isPhone) return;
    const container = paneScrollRef.current;
    if (!container) return;
    container.scrollTo({
      left: pane === "chat" ? 0 : container.clientWidth,
      behavior: skipTransition ? "auto" : "smooth",
    });
  }, [pane, isPhone, skipTransition]);

  const attachments = useMemo(
    (): CanvasChatAttachment[] =>
      attachedFieldIds
        .map((id) => page.fields[id])
        .filter((field) => field !== undefined)
        .map((field) => ({ fieldId: field.id, label: field.label })),
    [attachedFieldIds, page.fields],
  );

  const attachField = useCallback((fieldId: string) => {
    setAttachedFieldIds((current) =>
      current.includes(fieldId) ? current : [...current, fieldId],
    );
  }, []);

  const selectField = useCallback(
    (fieldId: string) => {
      setSelectedFieldId(fieldId);
      // Picking on the canvas is how you point at something for the
      // assistant, so in select mode it also attaches.
      if (isSelectMode) attachField(fieldId);
    },
    [isSelectMode, attachField],
  );

  const send = useCallback(
    (text: string) => {
      setChat((current) => [
        ...current,
        {
          id: `local-${current.length}`,
          role: "user",
          text,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      ]);
      setAttachedFieldIds([]);
    },
    [attachments],
  );

  const canvas = (
    <div className="relative h-full">
      <CanvasViewport
        ref={viewportRef}
        pageWidth={pageWidth}
        transform={transform}
        onTransformChange={setTransformByUser}
        className="h-full"
      >
        <div
          ref={pageRef}
          className="shadow-2xl"
          onClick={() => setSelectedFieldId(null)}
        >
          <CanvasPage
            page={page}
            device={device}
            selectedFieldId={selectedFieldId}
            attachedFieldIds={attachedFieldIds}
            onSelectField={selectField}
            isSelectMode={isSelectMode}
          />
        </div>
      </CanvasViewport>
      <CanvasToolbar
        className="absolute bottom-3 left-1/2 -translate-x-1/2"
        device={device}
        onDeviceChange={setDevice}
        scale={transform.scale}
        onZoomIn={() => {
          setNeedsFit(false);
          setTransform((t) => ({ ...t, scale: clampScale(t.scale * 1.2) }));
        }}
        onZoomOut={() => {
          setNeedsFit(false);
          setTransform((t) => ({ ...t, scale: clampScale(t.scale / 1.2) }));
        }}
        onFit={() => setNeedsFit(true)}
        isSelectMode={isSelectMode}
        onSelectModeChange={setIsSelectMode}
      />
    </div>
  );

  const fields = (
    <FieldsPanel
      page={page}
      selectedFieldId={selectedFieldId}
      onSelectField={setSelectedFieldId}
      onChangeField={(fieldId, value) =>
        setPage((current) => ({
          ...current,
          fields: {
            ...current.fields,
            [fieldId]: { ...current.fields[fieldId], value },
          },
        }))
      }
      onAttachField={attachField}
      attachedFieldIds={attachedFieldIds}
      isDevMode={isDevMode}
    />
  );

  const assistant = (
    <CanvasChat
      messages={chat}
      attachments={attachments}
      onRemoveAttachment={(fieldId) =>
        setAttachedFieldIds((current) => current.filter((id) => id !== fieldId))
      }
      onSend={send}
      suggestions={["Improve this page", "Shorten the headline"]}
    />
  );

  return (
    <div
      data-canvas-entered={entered}
      style={{ height: "100svh" }}
      className={cn(
        "relative flex w-full flex-col overflow-hidden bg-bg-canvas text-fg-primary font-sans",
        "transition-[opacity,transform] duration-300 ease-out",
        entered ? "scale-100 opacity-100" : "opacity-0",
      )}
    >
      {/* The pre-entry transform is inline because Tailwind has no scale-96. */}
      <style>{`[data-canvas-entered="false"]{transform:scale(${ENTER_SCALE})}`}</style>

      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border-float bg-bg-float px-3">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
        >
          <ArrowLeft size={14} />
          Back to editor
        </button>
        <span className="mx-1 h-5 w-px bg-border-float" aria-hidden />
        <span className="text-[0.8125rem] font-semibold tracking-tight">
          {page.title}
        </span>
        <span className="font-mono text-[0.6875rem] text-fg-secondary-alt">
          {page.urlPath}
        </span>
        {!isPhone && (
          <ModeToggle mode={mode} onChange={setMode} className="ml-auto" />
        )}
        {isPhone && (
          <PaneToggle pane={pane} onChange={setPane} className="ml-auto" />
        )}
      </header>

      {isPhone ? (
        <div
          ref={paneScrollRef}
          className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        >
          <div className="h-full w-full shrink-0 snap-start">{assistant}</div>
          <div className="h-full w-full shrink-0 snap-start">{canvas}</div>
        </div>
      ) : (
        /*
         * Both arrangements are the same three regions; only their geometry
         * changes. The fields list travels from the middle of the screen to
         * the right rail rather than one screen being swapped for another, so
         * the list you were reading is still the list you are reading when it
         * arrives.
         *
         * Absolutely positioned rather than a grid whose columns animate.
         * Both work — `grid-template-columns` does interpolate across `fr`
         * and `px` in Chromium, measured — but explicit edges keep the
         * geometry readable next to the transition that drives it.
         */
        <div data-canvas-mode={mode} className="relative min-h-0 flex-1">
          <div
            style={{
              width: CHAT_WIDTH,
              transition: ease(["transform", "opacity"]),
            }}
            className={cn(
              "absolute inset-y-0 left-0 overflow-hidden border-r border-border-float",
              mode === "canvas"
                ? "translate-x-0 opacity-100"
                : "-translate-x-full opacity-0",
            )}
          >
            <div className="h-full" style={{ width: CHAT_WIDTH }}>
              {assistant}
            </div>
          </div>

          {/* Scales up as it arrives, so it reads as the page being placed
              behind the fields rather than sliding in from somewhere. */}
          <div
            style={{
              left: mode === "canvas" ? CHAT_WIDTH : 0,
              right: mode === "canvas" ? RAIL_WIDTH : 0,
              transition: ease(["left", "right", "opacity", "transform"]),
            }}
            className={cn(
              "absolute inset-y-0",
              mode === "canvas"
                ? "scale-100 opacity-100"
                : "pointer-events-none scale-[0.97] opacity-0",
            )}
          >
            {canvas}
          </div>

          {/* The constant. A rail on the canvas, a centred column without it —
              same component, same scroll position, same selection. */}
          <div
            style={{
              ...(mode === "canvas"
                ? { left: `calc(100% - ${RAIL_WIDTH}px)`, width: RAIL_WIDTH }
                : {
                    left: `max(0px, calc(50% - ${FIELDS_COLUMN_WIDTH / 2}px))`,
                    width: `min(${FIELDS_COLUMN_WIDTH}px, 100%)`,
                  }),
              transition: ease(["left", "width"]),
            }}
            className={cn(
              "absolute inset-y-0",
              mode === "canvas"
                ? "border-l border-border-float"
                : "border-l border-transparent",
            )}
          >
            {fields}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The way in and out of the canvas.
 *
 * Two labelled states rather than one button that toggles, so the control
 * says where you are as well as where you can go — you can tell at a glance
 * which arrangement you are in without having to remember what you pressed.
 */
function ModeToggle({
  mode,
  onChange,
  className,
}: {
  mode: CanvasMode;
  onChange: (mode: CanvasMode) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Workspace"
      className={cn(
        "flex gap-0.5 rounded-md bg-bg-float-raised p-0.5",
        className,
      )}
    >
      {(
        [
          ["fields", "Fields", ListTree],
          ["canvas", "Canvas", Layers],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[0.6875rem]",
            mode === value
              ? "bg-bg-float font-medium text-fg-primary shadow-sm"
              : "text-fg-secondary hover:text-fg-primary",
          )}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The phone's chat/canvas switch.
 *
 * A visible control as well as a swipe, because a pane you can only reach by
 * guessing that it swipes is a pane most people never find.
 */
function PaneToggle({
  pane,
  onChange,
  className,
}: {
  pane: CanvasPane;
  onChange: (pane: CanvasPane) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Panes"
      className={cn(
        "flex gap-0.5 rounded-md bg-bg-float-raised p-0.5",
        className,
      )}
    >
      {(
        [
          ["chat", "Chat", MessageSquare],
          ["canvas", "Canvas", Layers],
        ] as const
      ).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={pane === value}
          onClick={() => onChange(value)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded px-2 text-[0.6875rem]",
            pane === value
              ? "bg-bg-float font-medium text-fg-primary shadow-sm"
              : "text-fg-secondary",
          )}
        >
          <Icon size={12} />
          {label}
        </button>
      ))}
    </div>
  );
}
