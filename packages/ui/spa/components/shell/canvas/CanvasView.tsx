import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Layers, MessageSquare } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { useShellBreakpoint } from "../useShellBreakpoint";
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

export type CanvasViewProps = {
  page: CanvasPageData;
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

  // A device switch changes the layout under the zoom, so it re-fits.
  useEffect(() => setNeedsFit(true), [device]);

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
        <div className="flex min-h-0 flex-1">
          <div className="w-[320px] shrink-0 border-r border-border-float">
            {assistant}
          </div>
          <div className="min-w-0 flex-1">{canvas}</div>
          <div className="w-[300px] shrink-0 border-l border-border-float">
            {fields}
          </div>
        </div>
      )}
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
