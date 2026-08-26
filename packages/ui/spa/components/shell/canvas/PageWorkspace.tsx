import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Layers,
  ListTree,
  LucideIcon,
  MousePointerSquareDashed,
  PanelLeft,
  X,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { CanvasPage } from "./CanvasPage";
import { CanvasToolbar } from "./CanvasToolbar";
import { CanvasViewport, clampScale, fitTransform } from "./CanvasViewport";
import { FieldsPanel } from "./FieldsPanel";
import { CanvasFields } from "./CanvasFields";
import { CanvasRouteBar } from "./CanvasRouteBar";
import { CANVAS_MAX_WIDTH } from "../EditorCanvas";
import { SourcePath } from "@valbuild/core";
import { ShellBreakpoint } from "../types";
import {
  CANVAS_DEVICE_HEIGHTS,
  CANVAS_DEVICE_WIDTHS,
  CanvasDevice,
  CanvasPageData,
  CanvasTransform,
} from "./types";

/**
 * What the canvas is showing, and therefore what the column beside it holds.
 *
 * `normal` is the page as a visitor sees it: links work, nothing is outlined,
 * and the column keeps the module editor. `fields` is the page as Val sees
 * it: every element it tracks is outlined, and the column swaps to the fields
 * actually found on the page. One control drives both, because they are one
 * idea — whether you are looking at the page or at its content.
 */
export type CanvasView = "normal" | "fields";

export type PageWorkspaceProps = {
  /** The module editor for the current selection. Shown when it is on. */
  children: ReactNode;
  breakpoint: ShellBreakpoint;
  /**
   * The fields Val found on the page.
   *
   * Drives the fields view and the demo page in Storybook. Absent in the app
   * until the running site can report what is on the route it is showing —
   * without it the canvas still works, it just only offers the normal view.
   */
  page?: CanvasPageData;
  /**
   * What to put on the canvas, at the size the device switch asks for.
   *
   * The app passes the running site itself; Storybook passes nothing and gets
   * the demo page built from `page`. A function rather than a node because the
   * device switch is owned here: the page has to be re-laid-out at the new
   * width, and something that was handed over already sized could not follow.
   */
  renderCanvas?: (viewport: {
    device: CanvasDevice;
    width: number;
    height: number;
    /**
     * Bumped every time the reload control is used.
     *
     * Handed over rather than kept here because only the caller knows what
     * reloading means for what it rendered — for a frame it is a remount, and
     * the caller is the one holding its `key`.
     */
    reloadKey: number;
    /**
     * Whether a click on the page picks the element under it.
     *
     * Follows the view, which is where that decision already lives: in the
     * normal view the canvas is the page and a click on a link should follow
     * it. Passed down rather than taken as a prop so there is one answer.
     */
    isPicking: boolean;
    /** Ask for the page again, as the reload control does. */
    onRequestReload: () => void;
  }) => ReactNode;
  /**
   * The content paths the running page reported finding on itself.
   *
   * The app's stand-in for `page`: Val cannot yet say what *kind* of field each
   * one is or what it holds, but it can say which ones are there, and that is
   * enough for the column to list them and for a click to open one.
   */
  canvasPaths?: readonly SourcePath[];
  /** Open one of those paths in the editor. */
  onSelectCanvasPath?: (path: SourcePath) => void;
  /** The path the editor is on, highlighted in the fields column to match. */
  selectedCanvasPath?: SourcePath | null;
  /**
   * The route the canvas is showing, and how to change it.
   *
   * Present only where the canvas is a real browser — the app. Storybook's demo
   * page is not on a route, so it gets no address bar.
   */
  canvasRoute?: string;
  onCanvasRouteChange?: (route: string) => void;
  /** Routes Val tracks, offered as suggestions in the address bar. */
  canvasRoutes?: readonly string[];
  /**
   * Where the canvas was left looking, from a link.
   *
   * Applied instead of fitting the page: a link that says where to look should
   * not be overruled by the canvas's own idea of a good default.
   */
  initialTransform?: CanvasTransform | null;
  /** Reported as the canvas is panned and zoomed, so a link can carry it. */
  onTransformChange?: (transform: CanvasTransform) => void;
  isCanvasOpen: boolean;
  onCloseCanvas: () => void;
  view: CanvasView;
  onViewChange: (view: CanvasView) => void;
  isDevMode?: boolean;
  /** Hand a field to the assistant, which opens the AI panel. */
  onAttachToChat?: (fieldId: string, label: string) => void;
  /** Skips the entrance transition — for screenshots and for tests. */
  skipTransition?: boolean;
};

/** Width the module column settles at once the canvas is beside it. */
const COLUMN_WIDTH = "clamp(340px, 34%, 520px)";
/**
 * How narrow the editor column may be dragged.
 *
 * Not a taste judgement: below this the field labels wrap and the rich text
 * toolbar starts collapsing, so a column narrower than this is not an editor
 * any more. The canvas gets the same floor for the same reason — a sliver of a
 * page is not a preview of it.
 */
const MIN_COLUMN_PX = 320;
const MIN_CANVAS_PX = 280;
/**
 * How wide the editor column may be dragged, as a share of the workspace.
 *
 * A cap rather than `container - MIN_CANVAS_PX` alone, so that on a very wide
 * screen the editor does not grow past the width it is designed to be read at
 * while leaving an ocean of canvas nobody asked for.
 */
const MAX_COLUMN_SHARE = 0.72;
/** How far an arrow key moves the divider. */
const KEYBOARD_STEP_PX = 24;
/**
 * Where a phone's pane content starts: below the top bar and below the strip
 * of switches under it.
 */
const PHONE_STRIP_CLEARANCE = "6.75rem";
/** Long enough to follow the column across, short enough not to wait. */
const OPEN_MS = 320;
/** The switch thumb moves faster: it is a short distance and a direct answer. */
const SWITCH_MS = 200;
/** How long the panes have to be still before the switch reads them. */
const PANE_SETTLE_MS = 140;
const OPEN_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * The editor, with a canvas that can join it.
 *
 * Closed, this is exactly the shell's editor: one centred column, unchanged.
 * Opening the canvas does not replace that column with a different screen —
 * it narrows it and puts the page beside it, so what you were editing is
 * still the thing in front of you. That is the whole point of adding rather
 * than switching: there is no "back", because you never left.
 *
 * On a phone there is no room to put two things side by side, so the same
 * two regions become panes that snap horizontally — editor first, canvas
 * second — which keeps both reachable without either being cramped.
 */
export function PageWorkspace({
  children,
  breakpoint,
  page,
  renderCanvas,
  canvasPaths,
  onSelectCanvasPath,
  selectedCanvasPath,
  canvasRoute,
  onCanvasRouteChange,
  canvasRoutes,
  initialTransform,
  onTransformChange,
  isCanvasOpen,
  onCloseCanvas,
  view,
  onViewChange,
  isDevMode,
  onAttachToChat,
  skipTransition,
}: PageWorkspaceProps) {
  const isPhone = breakpoint === "mobile";
  const reducedMotion = usePrefersReducedMotion();
  /**
   * Whether there is a canvas to open at all.
   *
   * Either source is enough: the app supplies the running page through
   * `renderCanvas`, Storybook supplies the demo page through `page`. Requiring
   * `page` specifically is what kept the app's canvas from ever opening — the
   * button appeared, the frame mounted, and the column never moved.
   */
  const hasCanvas = page !== undefined || renderCanvas !== undefined;
  const open = isCanvasOpen && hasCanvas;
  /**
   * Whether the canvas has ever been opened.
   *
   * The pane's wrapper stays mounted while closed so opening it can animate,
   * but what is inside must not be built until it is asked for: in the app
   * `renderCanvas` is an iframe on the running site, and mounting it while the
   * canvas is closed loads the entire site on every studio load — a page load
   * nobody asked for, whose console output arrives as the studio's own.
   *
   * A ref, because it is derived from `open` and changes in the same render
   * `open` does: state here would mean a second render to catch up, and the
   * frame would mount one frame after the pane became visible.
   */
  const hasBeenOpen = useRef(false);
  if (open) {
    hasBeenOpen.current = true;
  }

  const ease = (properties: string[]) =>
    reducedMotion || skipTransition
      ? undefined
      : properties.map((p) => `${p} ${OPEN_MS}ms ${OPEN_EASE}`).join(", ");

  const [device, setDevice] = useState<CanvasDevice>("desktop");
  const [transform, setTransform] = useState<CanvasTransform>(
    () => initialTransform ?? { scale: 1, x: 0, y: 0 },
  );
  // Reported on every change, including the fit: the fitted position is a
  // position, and a link copied without touching anything should restore it.
  useEffect(() => {
    onTransformChange?.(transform);
  }, [transform, onTransformChange]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [attachedFieldIds, setAttachedFieldIds] = useState<string[]>([]);
  const [pane, setPane] = useState<WorkspacePane>("editor");

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const paneScrollRef = useRef<HTMLDivElement>(null);
  const splitRef = useRef<HTMLDivElement>(null);

  /**
   * The split between editor and canvas.
   *
   * `null` means nobody has dragged it, and the column keeps its designed
   * width — a responsive clamp, which is a better default at every screen size
   * than any single number this could be initialised to. Once dragged it is a
   * pixel width, because that is what the drag produces and what the person
   * dragging is choosing.
   */
  const [columnPx, setColumnPx] = useState<number | null>(null);
  // The canvas shows a document Val does not render: a server component
  // re-reads content when the page is requested, so some changes only arrive
  // on a reload.
  const [reloadKey, setReloadKey] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  // The workspace's own width, which is what the limits are relative to: the
  // same column is reasonable on a 1600px screen and far too wide on a 900px
  // one.
  const [splitWidth, setSplitWidth] = useState(0);
  useEffect(() => {
    const el = splitRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSplitWidth(el.clientWidth));
    observer.observe(el);
    setSplitWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  /**
   * The range the divider may sit in, for this workspace at this width.
   *
   * Both ends can be impossible at once on a narrow window — there is not
   * always room for a usable editor *and* a usable canvas — so the floor wins
   * and the max is never allowed below it. That keeps the editor whole and lets
   * the canvas be the thing that gets cramped, which is the right way round:
   * the editor is what the work happens in.
   */
  const columnBounds = useMemo(() => {
    if (splitWidth === 0) return { min: MIN_COLUMN_PX, max: MIN_COLUMN_PX };
    const max = Math.max(
      MIN_COLUMN_PX,
      Math.min(splitWidth * MAX_COLUMN_SHARE, splitWidth - MIN_CANVAS_PX),
    );
    return { min: Math.min(MIN_COLUMN_PX, max), max };
  }, [splitWidth]);

  const clampColumn = useCallback(
    (px: number) =>
      Math.round(Math.min(columnBounds.max, Math.max(columnBounds.min, px))),
    [columnBounds],
  );

  // A window resize can put the divider outside the range it was dragged
  // within, so it follows the range down rather than leaving the canvas at
  // nothing.
  useEffect(() => {
    if (columnPx === null) return;
    const next = clampColumn(columnPx);
    if (next !== columnPx) setColumnPx(next);
  }, [columnPx, clampColumn]);

  /**
   * Dragging the divider.
   *
   * Pointer capture rather than window listeners: the pointer leaves the
   * handle immediately and would otherwise be lost to whatever is underneath
   * — including the canvas frame, which is a different document and swallows
   * events entirely.
   */
  const onDividerPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const container = splitRef.current;
      if (!container) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      const left = container.getBoundingClientRect().left;
      const move = (moveEvent: PointerEvent) => {
        setColumnPx(clampColumn(moveEvent.clientX - left));
      };
      const finish = () => {
        setIsDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [clampColumn],
  );

  const nudgeDivider = useCallback(
    (delta: number) => {
      const container = splitRef.current;
      const current =
        columnPx ?? container?.firstElementChild?.clientWidth ?? MIN_COLUMN_PX;
      setColumnPx(clampColumn(current + delta));
    },
    [columnPx, clampColumn],
  );

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
  // A link that names a position has already answered the question fitting
  // exists to answer, so it is not overruled by one.
  const [needsFit, setNeedsFit] = useState(initialTransform == null);
  useEffect(() => {
    if (!needsFit || !open) return;
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
  }, [needsFit, fit, open]);

  /**
   * Opening the canvas, and switching device, both change the box the page has
   * to fit into. The column also finishes moving a third of a second after the
   * click, and the observer above catches that too.
   *
   * A CHANGE in the box, not merely a render in which the box has a value. A
   * link that names a position has already answered the question fitting exists
   * to answer, and the canvas can be open from the very first render when a link
   * says so — so anything that treats the first run as a transition overwrites
   * exactly what the link was carrying, and the link looks like it did not work.
   *
   * The previous box is a ref updated inside the effect rather than a flag the
   * first run consumes: an effect can be run more than once for one commit —
   * StrictMode does exactly that on mount — and a flag consumed by the first run
   * turns the second into a spurious "the box changed".
   */
  const lastBox = useRef({ device, open });
  useEffect(() => {
    if (lastBox.current.device === device && lastBox.current.open === open) {
      return;
    }
    lastBox.current = { device, open };
    setNeedsFit(true);
  }, [device, open]);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
    // A reloaded page can be a different height, so the fit it had is no
    // longer the right one.
    setNeedsFit(true);
  }, []);

  const setTransformByUser = useCallback((next: CanvasTransform) => {
    setNeedsFit(false);
    setTransform(next);
  }, []);

  // Opening the canvas on a phone means going to it; closing means coming
  // back. The switch and the swipe then agree about where you are.
  useEffect(() => setPane(open ? "canvas" : "editor"), [open]);

  // The phone's panes are a scroll container, so moving between them is a
  // scroll — which keeps the swipe and the button doing the same thing, and
  // means the switch slides the canvas in rather than cutting to it.
  //
  // The first placement is not a move anyone made, so it lands without
  // animating; every later one glides.
  const hasPlacedPane = useRef(false);
  useEffect(() => {
    if (!isPhone) return;
    const container = paneScrollRef.current;
    if (!container) return;
    const smooth = hasPlacedPane.current && !skipTransition && !reducedMotion;
    hasPlacedPane.current = true;
    container.scrollTo({
      left: pane === "canvas" && open ? container.clientWidth : 0,
      behavior: smooth ? "smooth" : "auto",
    });
  }, [pane, open, isPhone, skipTransition, reducedMotion]);

  /**
   * A swipe moves the panes without going through the switch, so the switch
   * reads the scroll position back rather than assuming it is in charge.
   *
   * Read once movement stops, not on every frame: a smooth scroll passes
   * through the half-way mark on its way, and reacting to that would set the
   * switch back to where it came from, which sends the scroll back after it.
   * Waiting for the rest answers the only question worth asking — where did
   * this end up — and cannot fight an animation still in progress.
   */
  const paneSettle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPaneScroll = useCallback(() => {
    if (paneSettle.current !== null) clearTimeout(paneSettle.current);
    paneSettle.current = setTimeout(() => {
      paneSettle.current = null;
      const container = paneScrollRef.current;
      if (!container || container.clientWidth === 0) return;
      const next: WorkspacePane =
        container.scrollLeft > container.clientWidth / 2 ? "canvas" : "editor";
      setPane((current) => (current === next ? current : next));
    }, PANE_SETTLE_MS);
  }, []);
  useEffect(
    () => () => {
      if (paneSettle.current !== null) clearTimeout(paneSettle.current);
    },
    [],
  );

  const attachField = useCallback(
    (fieldId: string) => {
      setAttachedFieldIds((current) =>
        current.includes(fieldId) ? current : [...current, fieldId],
      );
      const field = page?.fields[fieldId];
      if (field) onAttachToChat?.(field.id, field.label);
    },
    [page, onAttachToChat],
  );

  /**
   * Whether a click on the page selects what it hits.
   *
   * Its own state with its own button, not a consequence of the view. Each view
   * has an obvious default — the fields view exists to aim at things, the normal
   * view is the page as a visitor meets it, links and all — so switching views
   * sets it, and the button is how you disagree with the default. Deriving it
   * from the view meant the only way to point at something on the page was to
   * give up the module editor for the fields list, and no way at all to read the
   * page normally while still being able to select a piece of it.
   */
  const [isPicking, setIsPicking] = useState(view === "fields");
  const lastView = useRef(view);
  if (lastView.current !== view) {
    lastView.current = view;
    setIsPicking(view === "fields");
  }

  /**
   * Clears the floating rail, which the narrowed column now reaches under.
   *
   * Inline because `md:px-6` lives in a media query and would otherwise win
   * over any `pl-*` utility regardless of class order.
   */
  const railPadding =
    breakpoint === "desktop" && open ? { paddingLeft: "5.5rem" } : undefined;

  /**
   * The switch that decides what the column holds.
   *
   * Only offered when there is something to switch to: the fields view is a
   * list of what Val found on the page, so without that list there is one view
   * and a control with a single option.
   */
  const reportedPaths = canvasPaths ?? [];
  const fieldCount = page
    ? Object.keys(page.fields).length
    : reportedPaths.length;
  const viewToggle =
    fieldCount > 0 ? (
      <ViewToggle
        view={view}
        onChange={onViewChange}
        fieldCount={fieldCount}
        animate={!reducedMotion}
      />
    ) : null;

  /**
   * Whether the row above the column is there to clear the floating top bar.
   *
   * With the canvas open the switch normally supplies that gap, so the column
   * itself does not — but when there is no switch nothing does, and the editor
   * starts underneath the top bar.
   */
  const columnHasHeaderRow = open && !isPhone && viewToggle !== null;

  const moduleColumn = (
    // `val-content-area` is what ValRouter scrolls when it is asked to bring a
    // field into view, so the id has to be on the element that actually
    // scrolls the editor.
    <div
      id="val-content-area"
      /**
       * How far below the container's top a field has to land.
       *
       * Read by `doScroll` in `ValRouter`, because only this layout knows what
       * is covering the column. With the view switch on screen the switch has a
       * row of its own above the scroller and a small gap is enough; without it
       * the column runs up under the shell's floating top bar, and a field
       * scrolled flush to the top lands behind it.
       */
      data-scroll-clearance={columnHasHeaderRow ? 16 : 96}
      className="h-full overflow-y-auto scrollbar-slim"
    >
      {/*
       * `w-full` matters: without a definite width the box shrink-to-fits its
       * content, and `mx-auto` then centres a box wider than the column —
       * which clips the editor on both sides instead of scrolling it.
       */}
      <div
        style={{ maxWidth: CANVAS_MAX_WIDTH, ...railPadding }}
        className={cn(
          "w-full mx-auto px-4 md:px-6 pb-24",
          // The switch above supplies the top gap when it is there; without it
          // the column has to clear the top bar itself.
          columnHasHeaderRow ? "pt-1" : "pt-20 desktop:pt-24",
        )}
      >
        {children}
      </div>
    </div>
  );

  const pathsColumn = !page && reportedPaths.length > 0 && (
    <div style={railPadding} className="h-full pb-14">
      <CanvasFields
        paths={reportedPaths}
        selectedPath={selectedCanvasPath}
        onSelect={onSelectCanvasPath}
        isDevMode={isDevMode}
      />
    </div>
  );

  const fieldsColumn = page && (
    <div style={railPadding} className="h-full pb-14">
      <FieldsPanel
        page={page}
        selectedFieldId={selectedFieldId}
        onSelectField={setSelectedFieldId}
        onChangeField={() => undefined}
        onAttachField={attachField}
        attachedFieldIds={attachedFieldIds}
        isDevMode={isDevMode}
      />
    </div>
  );

  /**
   * The column, with the switch that decides what is in it.
   *
   * The switch sits at the top of the column rather than on the canvas,
   * because the column is what it changes — and it stays in exactly the same
   * place in both views, so the control does not move out from under you at
   * the moment the thing below it is swapped.
   */
  const column = (
    <div className="flex h-full min-h-0 flex-col">
      {columnHasHeaderRow && (
        <div style={railPadding} className="shrink-0 px-4 md:px-6 pt-20 pb-2.5">
          {viewToggle}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {/*
         * The fields view has two forms. Storybook's demo page carries the
         * values, so it gets the designed panel; a real page can only report
         * which fields are on it, so it gets the list of those. Either way the
         * switch above only exists when one of them has something in it.
         */}
        {view === "fields" && open && (fieldsColumn || pathsColumn)
          ? fieldsColumn || pathsColumn
          : moduleColumn}
      </div>
    </div>
  );

  const routeBar = canvasRoute !== undefined && onCanvasRouteChange && (
    <CanvasRouteBar
      value={canvasRoute}
      routes={canvasRoutes ?? []}
      onChange={onCanvasRouteChange}
      // Wide enough to read a real route, narrow enough to leave the page the
      // middle of the pane.
      className="absolute left-3 top-3 z-window w-[min(22rem,calc(100%-5rem))]"
    />
  );

  const canvasPane = hasCanvas && hasBeenOpen.current && (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-xl border border-border-float bg-bg-float-raised",
      )}
    >
      {routeBar}
      <CanvasViewport
        ref={viewportRef}
        pageWidth={pageWidth}
        transform={transform}
        onTransformChange={setTransformByUser}
        horizontalWheelPans={!isPhone}
        className="h-full"
      >
        <div
          ref={pageRef}
          className="shadow-2xl"
          onClick={() => setSelectedFieldId(null)}
        >
          {renderCanvas?.({
            device,
            width: pageWidth,
            height: CANVAS_DEVICE_HEIGHTS[device],
            reloadKey,
            isPicking,
            onRequestReload: reload,
          }) ??
            (page && (
              <CanvasPage
                page={page}
                device={device}
                selectedFieldId={isPicking ? selectedFieldId : null}
                attachedFieldIds={isPicking ? attachedFieldIds : []}
                onSelectField={(fieldId) => {
                  if (isPicking) setSelectedFieldId(fieldId);
                }}
                isSelectMode={isPicking}
              />
            ))}
        </div>
      </CanvasViewport>

      <button
        type="button"
        aria-label="Close canvas"
        onClick={onCloseCanvas}
        className="absolute top-3 right-3 grid h-8 w-8 place-items-center rounded-md border border-border-float bg-bg-float text-fg-secondary shadow-lg hover:text-fg-primary"
      >
        <X size={15} />
      </button>

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
        // Only where there is something to select. The demo page reports no
        // paths, so a click on it has nothing to open.
        isPicking={isPicking}
        onPickingChange={fieldCount > 0 ? setIsPicking : undefined}
        // Only where reloading means something. The demo page renders from
        // data that is already live, so it has nothing to fetch again.
        onReload={renderCanvas && reload}
      />
    </div>
  );

  if (isPhone) {
    return (
      <div className="absolute inset-0 bg-bg-canvas">
        <div
          ref={paneScrollRef}
          onScroll={onPaneScroll}
          className={cn(
            "flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain",
            !open && "overflow-x-hidden",
          )}
        >
          {/* Both panes start below the switch strip, so the strip never
              covers the top of either one. */}
          <div
            className="h-full w-full shrink-0 snap-start"
            style={open ? { paddingTop: PHONE_STRIP_CLEARANCE } : undefined}
          >
            {column}
          </div>
          {open && (
            <div
              style={{ paddingTop: PHONE_STRIP_CLEARANCE }}
              className="h-full w-full shrink-0 snap-start p-3 pb-14"
            >
              {canvasPane}
            </div>
          )}
        </div>
        {/*
         * Both switches ride above the panes rather than inside one of them:
         * the pane switch has to be reachable from either side, and the view
         * switch changes both halves at once, so neither belongs to a pane.
         *
         * A visible switch as well as a swipe, because a pane you can only
         * reach by guessing that it swipes is a pane most people never find.
         */}
        {open && (
          <div className="absolute inset-x-3 top-[4.5rem] flex items-center gap-2">
            <PaneToggle
              pane={pane}
              onChange={setPane}
              animate={!reducedMotion}
            />
            {/* The view switch picks what the editor pane holds, so it
                appears on that pane — the same place it sits on desktop,
                at the top of the column it changes. */}
            {pane === "editor" && <span className="ml-auto">{viewToggle}</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={splitRef}
      className="absolute inset-0 flex overflow-hidden bg-bg-canvas"
    >
      <div
        style={{
          width: open
            ? columnPx !== null
              ? `${columnPx}px`
              : COLUMN_WIDTH
            : "100%",
          // A width being animated cannot also be dragged — the column would
          // lag a third of a second behind the pointer — so the transition
          // belongs to opening and closing, not to the drag.
          transition: isDragging ? undefined : ease(["width"]),
        }}
        className="relative h-full min-w-0 shrink-0"
      >
        {column}
      </div>
      {open && (
        <SplitDivider
          isDragging={isDragging}
          onPointerDown={onDividerPointerDown}
          onNudge={nudgeDivider}
        />
      )}
      {/*
       * Scales up as it arrives, so it reads as the page being placed beside
       * the editor rather than sliding in from off screen.
       *
       * `invisible` rather than only `opacity-0` when closed: a transparent
       * pane is still in the accessibility tree and still in the tab order,
       * so the canvas controls would be reachable on a page that has no
       * canvas open. `visibility` takes both away and still transitions.
       */}
      <div
        style={{ transition: ease(["opacity", "transform"]) }}
        className={cn(
          "min-w-0 flex-1 pt-20 pb-14 pr-3",
          open
            ? "scale-100 opacity-100"
            : "invisible pointer-events-none scale-95 opacity-0",
        )}
      >
        {canvasPane}
      </div>
    </div>
  );
}

/**
 * The grab handle between the editor and the canvas.
 *
 * A `separator` with the keyboard behaviour that implies, not just a draggable
 * strip: how much room the page gets against how much the editor gets is a real
 * decision, and one that should not need a mouse to make. The hit area is wider
 * than the line it draws, because a 1px target is a target nobody hits.
 */
function SplitDivider({
  isDragging,
  onPointerDown,
  onNudge,
}: {
  isDragging: boolean;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onNudge: (delta: number) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the editor and canvas"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onNudge(-KEYBOARD_STEP_PX);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          onNudge(KEYBOARD_STEP_PX);
        }
      }}
      className={cn(
        // `z-hover`: the grab handle sits over the edge of both panes. It said
        // `z-10`, which is not on this project's scale at all, so Tailwind
        // emitted nothing and it was relying on source order.
        "group relative z-hover w-3 shrink-0 cursor-col-resize self-stretch",
        "focus-visible:outline-none",
      )}
    >
      {/* The line, centred in the wider hit area. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-14 left-1/2 w-px -translate-x-1/2 rounded-full",
          "transition-colors",
          isDragging
            ? "bg-fg-brand-primary"
            : "bg-border-float group-hover:bg-fg-secondary group-focus-visible:bg-fg-brand-primary",
        )}
      />
    </div>
  );
}

/** Which half of the workspace a phone is showing. */
export type WorkspacePane = "editor" | "canvas";

/**
 * A two-state switch whose selected state travels between the options.
 *
 * The thumb moves rather than the highlight jumping, because on a phone the
 * pane switch and the swipe do the same thing — and a control that slides
 * says that, where one that blinks between two colours does not.
 *
 * Options are laid out in equal columns (`auto-cols-fr`) so the thumb can be
 * one column wide and travel by exactly one column, whatever the labels say.
 */
function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  animate,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{
    value: T;
    label: string;
    icon: LucideIcon;
    /** Shown after the label, held back. */
    badge?: number;
  }>;
  animate: boolean;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  return (
    <div
      role="tablist"
      aria-label={label}
      className="relative inline-grid auto-cols-fr grid-flow-col rounded-md border border-border-float bg-bg-float p-0.5"
    >
      <span
        aria-hidden
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
          transition: animate
            ? `transform ${SWITCH_MS}ms ${OPEN_EASE}`
            : undefined,
        }}
        className="absolute inset-y-0.5 left-0.5 rounded bg-bg-float-raised shadow-sm"
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            // Above the thumb, which is painted behind the whole row.
            "relative inline-flex h-7 items-center justify-center gap-1.5 rounded px-2.5 text-[0.6875rem] transition-colors",
            value === option.value
              ? "font-medium text-fg-primary"
              : "text-fg-secondary hover:text-fg-primary",
          )}
        >
          <option.icon size={12} />
          {option.label}
          {option.badge !== undefined && (
            <span className="tabular-nums text-fg-secondary-alt">
              {option.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * The phone's editor/canvas switch.
 *
 * A visible switch as well as a swipe, because a pane you can only reach by
 * guessing that it swipes is a pane most people never find.
 */
function PaneToggle({
  pane,
  onChange,
  animate,
}: {
  pane: WorkspacePane;
  onChange: (pane: WorkspacePane) => void;
  animate: boolean;
}) {
  return (
    <SegmentedControl
      label="Workspace pane"
      value={pane}
      onChange={onChange}
      animate={animate}
      options={[
        { value: "editor", label: "Editor", icon: PanelLeft },
        { value: "canvas", label: "Canvas", icon: Layers },
      ]}
    />
  );
}

/**
 * Normal view or the fields Val found on the page.
 *
 * Two labelled states rather than one button that toggles, so the control
 * says which view you are in as well as where you can go.
 */
function ViewToggle({
  view,
  onChange,
  fieldCount,
  animate,
}: {
  view: CanvasView;
  onChange: (view: CanvasView) => void;
  /** How many fields the page reported. Shown on the Fields tab. */
  fieldCount?: number;
  animate: boolean;
}) {
  return (
    <SegmentedControl
      label="Canvas view"
      value={view}
      onChange={onChange}
      animate={animate}
      options={[
        {
          value: "normal",
          label: "Normal",
          icon: MousePointerSquareDashed,
        },
        { value: "fields", label: "Fields", icon: ListTree, badge: fieldCount },
      ]}
    />
  );
}
