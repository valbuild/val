import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Eye,
  ListTree,
  LucideIcon,
  MousePointerSquareDashed,
  X,
} from "lucide-react";
import { cn } from "../../designSystem/cn";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { usePickingDefault } from "./usePickingDefault";
import { CanvasPage } from "./CanvasPage";
import { CanvasToolbar } from "./CanvasToolbar";
import {
  CanvasPinch,
  CanvasWindow,
  CanvasWindowHandle,
  ZOOM_STEP,
} from "./CanvasWindow";
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
  CanvasPoint,
  CanvasTransform,
  CanvasView,
} from "./types";

// Re-exported: this module named the type before the canvas had a types file,
// and the whole shell imports it from here.
export type { CanvasView };

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
    /**
     * Report that the page is re-rendering because of an edit.
     *
     * Only the page knows: its client store updates at once, and anything
     * rendered on the server changes only after a `router.refresh()` and its
     * round trip. Unsaid, the gap between typing and the canvas changing looks
     * like the canvas being stuck rather than busy.
     */
    onRefreshingChange: (isRefreshing: boolean) => void;
    /**
     * A two-finger gesture that landed on the page.
     *
     * The page is a frame and a frame keeps its own touches, so a pinch there
     * is invisible here unless the page relays it. Without this the only zoom
     * on a phone is the toolbar's + and -, which is not the gesture anyone
     * reaches for. See `ValCanvasBridge`.
     */
    onPinch: (gesture: CanvasPinch) => void;
    /** A ctrl/cmd + wheel zoom over the page, relayed for the same reason. */
    onZoom: (factor: number, center: CanvasPoint) => void;
    /**
     * Something on the page was picked.
     *
     * The pick itself is the caller's to act on — it owns navigation — but the
     * canvas has to know one happened, because selecting on the page is a
     * request to go and edit the thing selected, and where that is is the
     * canvas's business: the fields column, and on a phone the pane holding it.
     */
    onPicked: () => void;
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
  /**
   * Which of the phone's two panes is on screen. Ignored above that breakpoint,
   * where both are.
   *
   * Owned by the shell rather than here, because the shell's Preview button is
   * the main way between them: on a phone it does not open a region beside the
   * editor, it takes you to the page and back again. Keeping the pane here as
   * well would give that button and this switch two different ideas of where
   * you are.
   */
  pane: WorkspacePane;
  onPaneChange: (pane: WorkspacePane) => void;
  isDevMode?: boolean;
  /** Hand a field to the assistant, which opens the AI panel. */
  /**
   * Mention this field in the assistant, by its val source path.
   *
   * The SOURCE path rather than the canvas's own field id: what reaches the
   * assistant is a reference the model can look up, and a canvas id means
   * nothing outside this component.
   */
  onAttachToChat?: (sourcePath: string) => void;
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
/** Where the phone's strip of switches sits, below the floating top bar. */
const PHONE_STRIP_TOP = "4.5rem";
/**
 * Where a phone's pane content starts: below the top bar, below the strip of
 * switches under it, and clear of it.
 *
 * The strip ends at 6.625rem — {@link PHONE_STRIP_TOP} plus the switch's own
 * 2.125rem — so the rest of this is deliberate air. It used to be 2px, which
 * read as the switches being stuck to the top of the fields rather than being
 * a row of their own above them.
 */
const PHONE_STRIP_CLEARANCE = "8.25rem";
/** The height of everything on the phone's strip, switches and exit alike. */
const PHONE_STRIP_CONTROL_HEIGHT = "2.125rem";
/** Long enough to follow the column across, short enough not to wait. */
const OPEN_MS = 320;
/** The switch thumb moves faster: it is a short distance and a direct answer. */
const SWITCH_MS = 200;
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
 * On a phone there is no room to put two things side by side, so the same two
 * regions become panes on a track that slides — editor first, canvas second —
 * which keeps both reachable without either being cramped.
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
  pane,
  onPaneChange,
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
  /**
   * Whether the canvas is on screen, and therefore whether it exists at all.
   *
   * The canvas is built exactly while it is open — never before, and not one
   * render after it closes. Before, because in the app `renderCanvas` is an
   * iframe on the running site, and mounting it while the canvas is closed
   * loads the entire site on every studio load: a page load nobody asked for,
   * whose console output arrives as the studio's own. After, because a closed
   * canvas that is merely hidden is still a second copy of the site running in
   * this tab, still polling, still holding whatever it holds.
   *
   * What must NOT unmount it is anything short of closing: switching between
   * the phone's modes moves the panes and changes what the left one holds, and
   * the frame keeps its scroll position, its client state and its route
   * throughout. That is the whole point of the modes — edit, look, edit again —
   * and a reload between each of those is the one thing that would ruin it.
   */
  const open = isCanvasOpen && hasCanvas;

  const ease = (properties: string[]) =>
    reducedMotion || skipTransition
      ? undefined
      : properties.map((p) => `${p} ${OPEN_MS}ms ${OPEN_EASE}`).join(", ");

  /**
   * Which width the page is shown at.
   *
   * A phone starts on the phone layout, and that is not a nicety: a 1280px page
   * fitted into a phone-width pane lands at about 25%, which is a thumbnail
   * rather than a preview. The layout someone on a phone almost certainly wants
   * to look at is the one they are holding.
   *
   * The starting value only, so the switch stays theirs after that — including
   * the perfectly reasonable "check the desktop layout from my phone".
   */
  const [device, setDevice] = useState<CanvasDevice>(
    isPhone ? "mobile" : "desktop",
  );
  /**
   * How far the page is zoomed.
   *
   * Only the zoom: where the window is scrolled belongs to the browser now,
   * and is read back off the element rather than mirrored here. Keeping it in
   * state as well would mean a render of the whole workspace on every frame of
   * a flick, to tell it something it can already see.
   */
  const [scale, setScale] = useState(() => initialTransform?.scale ?? 1);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const scrollRef = useRef<CanvasPoint>({
    x: initialTransform?.x ?? 0,
    y: initialTransform?.y ?? 0,
  });
  // Reported on every change, including the fit: the fitted position is a
  // position, and a link copied without touching anything should restore it.
  useEffect(() => {
    onTransformChange?.({ scale, ...scrollRef.current });
  }, [scale, onTransformChange]);
  const onScrollChange = useCallback(
    (next: CanvasPoint) => {
      scrollRef.current = next;
      onTransformChange?.({ scale: scaleRef.current, ...next });
    },
    [onTransformChange],
  );
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [attachedFieldIds, setAttachedFieldIds] = useState<string[]>([]);

  /**
   * Leaving the canvas leaves nothing behind.
   *
   * Both of these describe a session with a page — what you had picked on it,
   * what you had handed to the assistant from it — and a page that is no longer
   * mounted has neither. Kept, they would come back with the NEXT page opened on
   * the canvas, pointing at fields that are not on it.
   */
  useEffect(() => {
    if (open) return;
    setSelectedFieldId(null);
    setAttachedFieldIds((current) => (current.length === 0 ? current : []));
  }, [open]);

  const canvasWindowRef = useRef<CanvasWindowHandle>(null);
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

  /**
   * Whether the window should keep the whole page in view.
   *
   * The window does the fitting — it is the only thing that knows both sizes,
   * and the page's height is not known for a frame or two after a frame mounts
   * — but whether a fit is still WANTED is decided here, and it stops being
   * wanted the moment someone zooms. A link that names a position has already
   * answered the question fitting exists to answer, so it is not overruled by
   * one.
   */
  const [autoFit, setAutoFit] = useState(initialTransform == null);

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
    setAutoFit(true);
  }, [device, open]);

  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
    // A reloaded page can be a different height, so the fit it had is no
    // longer the right one.
    setAutoFit(true);
  }, []);

  /**
   * A zoom someone asked for ends the fit.
   *
   * Answered once, by the window, rather than at each of the four ways of
   * asking: the buttons and the relayed gestures come through here, but a
   * ctrl/cmd + wheel over the canvas background never leaves the window at all.
   * That path had no way to say so, so a zoom made that way stayed armed for a
   * fit and was thrown away by the next resize — the split divider, the browser
   * window, or the column's own opening animation a third of a second later.
   */
  const onUserZoom = useCallback(() => setAutoFit(false), []);
  const zoomByUser = useCallback(
    (factor: number, center: CanvasPoint | null) => {
      canvasWindowRef.current?.zoomBy(factor, center);
    },
    [],
  );
  const onPinch = useCallback((gesture: CanvasPinch) => {
    canvasWindowRef.current?.pinch(gesture);
  }, []);

  const attachField = useCallback(
    (fieldId: string) => {
      setAttachedFieldIds((current) =>
        current.includes(fieldId) ? current : [...current, fieldId],
      );
      const field = page?.fields[fieldId];
      if (field) onAttachToChat?.(field.sourcePath);
    },
    [page, onAttachToChat],
  );

  /** See {@link usePickingDefault} — the view sets the default, the button disagrees. */
  const [isPicking, setIsPicking] = usePickingDefault(view);

  /**
   * Selecting something on the page takes you to it.
   *
   * Picking is not an end in itself: nobody outlines a headline to admire the
   * outline. The point of pointing at a thing is to change it, so a pick puts
   * the thing's field in front of you — the fields column, which is where the
   * page's own content lives, and which scrolls itself to the picked field
   * because it is told which one is selected.
   *
   * On a phone that also means changing pane. The fields column is in the
   * editor pane and the page is in the canvas pane, so a pick that only
   * switched the view left you looking at the page you had just selected on,
   * with the answer on a screen you had to know to swipe to.
   *
   * Both unconditionally, so that a pick always ends in the same place: asking
   * first whether the pane was already the editor's made the answer depend on
   * where you happened to be, which is exactly the kind of "sometimes" this
   * screen had too much of.
   *
   * The caller acts on the pick itself — it owns navigation — and only calls
   * this once that has SUCCEEDED. A pick that could not be turned into a field
   * to open must not move anything: half a transition, with the fields column
   * in front of you and the field it was opened for missing from it, is the
   * state that reads as the canvas being broken.
   */
  const onPicked = useCallback(() => {
    if (!isPicking) return;
    onViewChange("fields");
    if (isPhone) onPaneChange("editor");
  }, [isPicking, onViewChange, isPhone, onPaneChange]);

  /**
   * Whether the page is re-rendering because of an edit.
   *
   * Reported by the page, because only it knows: an edit updates its client
   * store at once, and anything rendered on the server changes only after a
   * `router.refresh()` and its round trip. Without saying so, the gap between
   * typing and the canvas changing looks like the canvas being stuck.
   */
  const [isRefreshing, setIsRefreshing] = useState(false);

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
   * Always both options, even before the page has reported anything. It used to
   * appear only once there was a list to show, which meant the one state where
   * someone needs to be told something — the page is not in preview mode, so it
   * mounts none of Val's client code and tags nothing — was the state with no
   * way to ask. The control went missing rather than explaining itself, and a
   * missing control cannot say why.
   *
   * The count is held back until there is one, so the tab does not read "Fields
   * 0" at a page that simply has not answered yet.
   */
  const reportedPaths = canvasPaths ?? [];
  const fieldCount = page
    ? Object.keys(page.fields).length
    : reportedPaths.length;
  const viewToggle = (
    <ViewToggle
      view={view}
      onChange={onViewChange}
      fieldCount={fieldCount > 0 ? fieldCount : undefined}
      animate={!reducedMotion}
    />
  );

  /**
   * The phone's one switch, and the three places it can put you.
   *
   * On a phone the view and the pane are not two questions. "Fields or normal"
   * only ever describes the left pane, and "editor or canvas" only ever moves
   * between that pane and the page — so asking them separately produced a
   * control whose two halves each changed meaning depending on the other, which
   * is how "Editor" came to mean "not the page" rather than anything about the
   * editor. One control over the three states there actually are says what it
   * does at every press: Normal is the module editor, Fields is the page's own
   * fields, Preview is the page. Leaving is the X beside it, and nothing else.
   *
   * All three always, the same rule the desktop switch follows. Fields used to
   * appear only once the page had reported some, which took the control away in
   * the one state where someone needs to be told something — and a tab that
   * comes and goes cannot explain its own absence. It explains itself instead;
   * see {@link FieldsAwaitingPage}.
   */
  const mobileMode: MobileMode =
    pane === "canvas" ? "preview" : view === "fields" ? "fields" : "normal";
  const setMobileMode = useCallback(
    (next: MobileMode) => {
      if (next === "preview") {
        onPaneChange("canvas");
        return;
      }
      onPaneChange("editor");
      onViewChange(next);
    },
    [onPaneChange, onViewChange],
  );

  /**
   * Whether the row above the column is there to clear the floating top bar.
   *
   * Wherever the switch is in a row of its own — beside the editor, with the
   * canvas open — that row supplies the gap and the column does not pay for it
   * again. It used to also ask whether there WAS a switch, which stopped being
   * a question when the switch stopped coming and going.
   */
  const columnHasHeaderRow = open && !isPhone;
  /**
   * Whether the column has to clear the shell's floating top bar itself.
   *
   * Something above it usually does: the switch row on desktop, and on a phone
   * with the canvas open the track's own `PHONE_STRIP_CLEARANCE`, which is sized
   * for the top bar AND the strip of switches under it. The phone case was
   * missing, so the column added its own 80px on top of that clearance — 188px
   * of emptiness above the first field, with the switches sitting in the middle
   * of it.
   */
  const columnClearsTopBar = !columnHasHeaderRow && !(open && isPhone);

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
          // See `columnClearsTopBar`: whatever is above the column supplies the
          // gap where there is one, and only where there is nothing does the
          // column pay for it.
          columnClearsTopBar ? "pt-20 desktop:pt-24" : "pt-1",
        )}
      >
        {children}
      </div>
    </div>
  );

  /**
   * The fields view, in whichever of its three forms applies.
   *
   * Storybook's demo page carries the values, so it gets the designed panel; a
   * real page can only report which fields are on it, so it gets the list of
   * those; and a page that has reported nothing gets told why, which is the
   * form that used to be a missing tab.
   *
   * The wrapper is padded exactly as the module editor's box is — `px-4
   * md:px-6`, and the same hairline above. The two views are the same column
   * holding different things, and they were inset differently: switching to
   * Fields slid the content sideways by 16px and pinned the card to the edge of
   * a phone screen.
   */
  const fieldsColumn = (
    <div style={railPadding} className="h-full px-4 md:px-6 pt-1 pb-14">
      {page ? (
        <FieldsPanel
          page={page}
          selectedFieldId={selectedFieldId}
          onSelectField={setSelectedFieldId}
          onChangeField={() => undefined}
          onAttachField={attachField}
          attachedFieldIds={attachedFieldIds}
          isDevMode={isDevMode}
        />
      ) : reportedPaths.length > 0 ? (
        <CanvasFields
          paths={reportedPaths}
          selectedPath={selectedCanvasPath}
          onSelect={onSelectCanvasPath}
        />
      ) : (
        <FieldsAwaitingPage
          // Only where the page is somewhere else. Beside the editor it is
          // already on screen, with its own button in it, and a control that
          // says "go there" pointing at something already in front of you is
          // worse than none.
          onGoToPreview={isPhone ? () => onPaneChange("canvas") : undefined}
        />
      )}
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
        {view === "fields" && open ? fieldsColumn : moduleColumn}
      </div>
    </div>
  );

  const routeBar = canvasRoute !== undefined && onCanvasRouteChange && (
    <CanvasRouteBar
      value={canvasRoute}
      routes={canvasRoutes ?? []}
      onChange={onCanvasRouteChange}
      // Takes the row it is on, up to a width where a real route is readable
      // without the field running the length of a desk.
      className="min-w-0 flex-1 md:max-w-[28rem]"
    />
  );

  /**
   * The canvas: an address bar, the page, and the page's controls — in that
   * order, each on its own row.
   *
   * All three used to float on top of the page. That is fine over a mockup and
   * wrong over a real site, because a real site puts its most important things
   * exactly where the chrome was sitting: the address bar covered the header
   * and whatever navigation was in it, and the toolbar covered the footer. You
   * could scroll the page under them, but a preview you have to scroll to see
   * the top of is not showing you the top of the page.
   *
   * Docking them costs about 80px of page height and gives back the two edges,
   * which is the right trade for a thing whose whole job is to be looked at.
   */
  const canvasPane = open && (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {(routeBar || !isPhone) && (
        <div className="flex shrink-0 items-center gap-2">
          {routeBar}
          {/*
           * Leaving the canvas, said as well as drawn.
           *
           * An X on its own is ambiguous — it could close the page, the studio,
           * or the thing the page is showing — and this one does something
           * worth being sure about, so where the canvas is a region beside the
           * editor the word is there beside the icon.
           *
           * Not on a phone. There the canvas is one of three modes, and the way
           * out of all three is one X on the strip that switches between them —
           * a second one here would be a way out that exists in one mode and
           * not the others, which is the sort of "sometimes" this screen is
           * meant to be rid of.
           */}
          {!isPhone && (
            <button
              type="button"
              aria-label="Exit Preview"
              onClick={onCloseCanvas}
              className={cn(
                "ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md pl-2.5 pr-3",
                "border border-border-float bg-bg-float text-fg-secondary",
                "hover:text-fg-primary",
              )}
            >
              <X size={15} />
              <span className="text-xs font-medium">Exit Preview</span>
            </button>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border-float bg-bg-float-raised">
        <CanvasWindow
          ref={canvasWindowRef}
          pageWidth={pageWidth}
          scale={scale}
          onScaleChange={setScale}
          autoFit={autoFit}
          onUserZoom={onUserZoom}
          initialScroll={
            initialTransform && { x: initialTransform.x, y: initialTransform.y }
          }
          onScrollChange={onScrollChange}
          className="h-full"
        >
          <div className="shadow-2xl" onClick={() => setSelectedFieldId(null)}>
            {renderCanvas?.({
              device,
              width: pageWidth,
              height: CANVAS_DEVICE_HEIGHTS[device],
              reloadKey,
              isPicking,
              onRequestReload: reload,
              onRefreshingChange: setIsRefreshing,
              onPinch,
              onZoom: (factor, center) => zoomByUser(factor, center),
              onPicked,
            }) ??
              (page && (
                <CanvasPage
                  page={page}
                  device={device}
                  selectedFieldId={isPicking ? selectedFieldId : null}
                  attachedFieldIds={isPicking ? attachedFieldIds : []}
                  onSelectField={(fieldId) => {
                    if (!isPicking) return;
                    setSelectedFieldId(fieldId);
                    // The demo page's version of what a pick does on a real one:
                    // go to the field. Kept in step deliberately, since this is
                    // the copy the design is reviewed against.
                    onPicked();
                  }}
                  isSelectMode={isPicking}
                />
              ))}
          </div>
        </CanvasWindow>
      </div>

      <div className="flex shrink-0 justify-center">
        <CanvasToolbar
          className="max-w-full"
          device={device}
          onDeviceChange={setDevice}
          scale={scale}
          onZoomIn={() => zoomByUser(ZOOM_STEP, null)}
          onZoomOut={() => zoomByUser(1 / ZOOM_STEP, null)}
          onFit={() => setAutoFit(true)}
          // Only where there is something to select. The demo page reports no
          // paths, so a click on it has nothing to open.
          isPicking={isPicking}
          onPickingChange={fieldCount > 0 ? setIsPicking : undefined}
          isRefreshing={isRefreshing}
          // Only where reloading means something. The demo page renders from
          // data that is already live, so it has nothing to fetch again.
          onReload={renderCanvas && reload}
        />
      </div>
    </div>
  );

  if (isPhone) {
    return (
      <div className="absolute inset-0 bg-bg-canvas">
        {/*
         * The two panes, on a track that is MOVED rather than scrolled.
         *
         * This was a scroll-snap container, and the trouble with it was never
         * the animation: it was that "which mode am I in" was a scroll offset,
         * so anything that touched the layout could answer the question. The
         * panes change contents as they sit there — the fields column fills in
         * one row at a time as each schema resolves — and a snap container
         * re-snaps to the area it last considered current whenever its contents
         * change, so a mode you had just chosen would be quietly undone a frame
         * later. Reading the offset back to find the mode then agreed with the
         * undo and scrolled the rest of the way, and a tap looked like it did
         * nothing. Clicking inside the frame made it worse, because focusing a
         * frame makes the browser scroll it back into view and that cancels a
         * smooth scroll trying to take it off screen.
         *
         * Three refs and two timers existed to paper over that, and all of it
         * came down to owning a number the browser also owned. A transform is
         * not a position anything else writes to: the mode is the state, the
         * track follows it, and there is nothing to read back. The move is
         * still smooth, and swiping — which the snap container gave for free —
         * is what the strip of switches above replaces.
         *
         * `overflow-clip` rather than `overflow-hidden`, and that is the
         * load-bearing half of it. A hidden box whose content overflows is
         * still a scroll PORT — it just has no scrollbar — so anything that
         * reveals an element can move it. Which is not hypothetical here: the
         * canvas pane holds a same-origin frame, `scrollIntoView` inside such a
         * frame walks out of it and scrolls the embedder's containers, and
         * clicking inside a frame makes the browser reveal the frame itself.
         * Both reveal an ELEMENT rather than a pane, so both can leave the track
         * anywhere — half the editor and half the page, which is the state the
         * phone kept getting stuck in. A clipped box is not a scroll port at
         * all, so there is no offset for any of that to write to.
         */}
        <div
          className="h-full overflow-clip"
          style={open ? { paddingTop: PHONE_STRIP_CLEARANCE } : undefined}
        >
          <div
            className="flex h-full w-full"
            style={{
              transform: `translateX(${open && pane === "canvas" ? "-100%" : "0%"})`,
              transition: ease(["transform"]),
            }}
          >
            <div className="h-full w-full shrink-0">{column}</div>
            {/*
             * Mounted for as long as the canvas is open, whichever mode is on
             * screen. Switching modes must not cost a page load — see `open`.
             */}
            {open && (
              <div className="h-full w-full shrink-0 p-3 pb-14">
                {canvasPane}
              </div>
            )}
          </div>
        </div>
        {/*
         * The switches ride above the panes rather than inside one of them:
         * they reach across both, and belong to neither.
         *
         * `z-window` because the canvas pane's own route bar is at that level
         * and `relative` alone does not scope it — without this the address bar
         * of a page you are not looking at can paint over the strip.
         */}
        {open && (
          <div
            className="absolute inset-x-3 z-window flex items-center gap-2"
            style={{ top: PHONE_STRIP_TOP }}
          >
            <MobileModeToggle
              mode={mobileMode}
              onChange={setMobileMode}
              // Held back until there is one, so the tab does not read
              // "Fields 0" at a page that has not answered yet.
              fieldCount={fieldCount > 0 ? fieldCount : undefined}
              animate={!reducedMotion}
            />
            {/*
             * The way out, from any of the three modes.
             *
             * Same height and same shell as the switch beside it. It is a
             * different kind of thing — a way out rather than a way around, so
             * it stands apart rather than being a fourth option — but one that
             * is a couple of pixels shorter than its neighbour reads as a
             * mistake, not as a distinction.
             */}
            <button
              type="button"
              aria-label="Exit Preview"
              onClick={onCloseCanvas}
              style={{
                height: PHONE_STRIP_CONTROL_HEIGHT,
                width: PHONE_STRIP_CONTROL_HEIGHT,
              }}
              className={cn(
                "ml-auto grid shrink-0 place-items-center rounded-md",
                "border border-border-float bg-bg-float text-fg-secondary",
              )}
            >
              <X size={15} />
            </button>
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
 * The fields view before the page has said what is on it.
 *
 * Almost always one thing: preview mode is off. Without that cookie the page
 * mounts none of Val's client code, so nothing tags its content and nothing
 * reports back — and the canvas says so, with the button that fixes it, because
 * the canvas is the thing holding the page.
 *
 * This used to be no tab at all. The switch appeared only once there was a list
 * to show, so the one state where someone needs to be told something was the
 * state with nothing to click, and the fields view read as a feature that comes
 * and goes. Saying it here costs a tab that is occasionally empty and buys an
 * answer to "where did Fields go".
 *
 * It does not claim preview mode IS off, because it cannot see: a page in
 * preview mode with no Val content on it reports nothing either, and telling
 * someone to turn on something already on is its own dead end.
 */
function FieldsAwaitingPage({
  onGoToPreview,
}: {
  /** Absent where the page is already on screen beside this column. */
  onGoToPreview?: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-xl border border-border-float bg-bg-float px-6 text-center">
      <ListTree size={20} className="text-fg-secondary-alt" />
      <div className="space-y-1.5">
        <h2 className="text-[0.8125rem] font-medium text-fg-primary">
          Nothing reported yet
        </h2>
        <p className="text-[0.6875rem] leading-relaxed text-fg-secondary-alt">
          This page has not told Val what is on it. Turn on preview mode in the
          Preview — until it is on, the page mounts none of Val's client code
          and tags nothing.
        </p>
      </div>
      {onGoToPreview && (
        <button
          type="button"
          onClick={onGoToPreview}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3",
            "border border-border-float bg-bg-float-raised text-xs font-medium",
            "text-fg-secondary hover:text-fg-primary",
          )}
        >
          <Eye size={13} />
          Go to Preview
        </button>
      )}
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
 * Where a phone is looking: one of the two left-hand views, or the page.
 *
 * The view and the pane, as the one question they are on a screen that can only
 * show one of them at a time. See `mobileMode` in `PageWorkspace`.
 */
type MobileMode = "normal" | "fields" | "preview";

/** One option on {@link MobileModeToggle}. */
type MobileModeOption = {
  value: MobileMode;
  label: string;
  icon: LucideIcon;
  badge?: number;
};

/** Where the thumb sits, in pixels from the inside of the control's border. */
type SegmentedThumb = { left: number; width: number };

/**
 * A switch whose selected state travels between the options.
 *
 * The thumb moves rather than the highlight jumping, because on a phone the
 * switch and the panes do the same thing — the track slides to the mode the
 * thumb slid to — and a control that slides says that, where one that blinks
 * between two colours does not.
 *
 * Each option is as wide as what is written on it, so every label gets the
 * SAME padding either side of it. Equal columns (`auto-cols-fr`) did not: the
 * widest option decides the column, so it ends up flush against its own
 * padding while every shorter one is centred in the slack left over. On the
 * canvas switch that is "Fields 18" against "Normal" — the count made the
 * fields option the wide one, so the selected pill looked tight around
 * "Fields 18" and roomy around "Normal", from the same `px-4`.
 *
 * The price is that the thumb can no longer be "one column, moved by one
 * column": it is measured off the selected button instead, which is what
 * {@link SegmentedThumb} holds.
 */
function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  animate,
  compact,
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
  /**
   * The tighter padding, for where the room is not there.
   *
   * The phone strip carries three options and the exit button on one line that
   * does not wrap, in `viewport - 24`; at the roomier padding that line runs off
   * a 390px screen and takes Preview — the only visible way to the page — with
   * it. Every option still gets the same padding as every other, which is what
   * this control is for; there is just less of it.
   */
  compact?: boolean;
}) {
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const listRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState<SegmentedThumb | null>(null);

  /*
   * Measured, and re-measured whenever a label's width can have changed.
   *
   * A layout effect rather than an effect: the first measurement has to land
   * before the browser paints, or the thumb is drawn at zero width and then
   * springs open. The observer covers the rest — a webfont arriving, the badge
   * going from 9 to 10, the control being laid out in a narrower column.
   */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const measure = () => {
      const buttons = list.querySelectorAll("button");
      const selected = buttons[index];
      if (selected === undefined) {
        return;
      }
      // Against the padding box, which is what `absolute; left: 0` is measured
      // from — `clientLeft` takes the border back off.
      const left =
        selected.getBoundingClientRect().left -
        list.getBoundingClientRect().left -
        list.clientLeft;
      const width = selected.getBoundingClientRect().width;
      setThumb((current) =>
        current !== null && current.left === left && current.width === width
          ? current
          : { left, width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    list
      .querySelectorAll("button")
      .forEach((button) => observer.observe(button));
    return () => observer.disconnect();
    // `options.length` rather than `options`: the array is a literal at every
    // call site, so depending on it would tear down and re-observe on every
    // render. What the effect reads off it is how many buttons there are; a
    // label or badge that changes width is what the observer is for.
  }, [index, options.length]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className="relative inline-flex rounded-md border border-border-float bg-bg-float p-0.5"
    >
      {/*
       * Only once there is a measurement to draw it at.
       *
       * Not `width: 0` until then: a transition runs off the style the element
       * was last painted with, and measuring forces a style recalculation — so
       * a thumb that exists at zero width has a zero width to animate FROM,
       * and every mount of the control played the pill growing out of nothing.
       * A node that was not there has no previous style, so its first paint is
       * simply where it belongs.
       */}
      {thumb !== null && (
        <span
          aria-hidden
          style={{
            width: thumb.width,
            transform: `translateX(${thumb.left}px)`,
            transition: animate
              ? `transform ${SWITCH_MS}ms ${OPEN_EASE}, width ${SWITCH_MS}ms ${OPEN_EASE}`
              : undefined,
          }}
          className="absolute inset-y-0.5 left-0 rounded bg-bg-float-raised shadow-sm"
        />
      )}
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            // Above the thumb, which is painted behind the whole row.
            "relative inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded text-[0.6875rem] transition-colors",
            compact ? "px-2.5" : "px-4",
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
 * The phone's one switch: the module editor, the page's fields, or the page.
 *
 * Three options in reading order, left to right, matching where each one puts
 * you: Normal and Fields are both the left pane and sit together on the left;
 * Preview is the pane to their right and sits on the right. Every option names
 * a destination — there is no "Editor" meaning "away from the page", which is
 * what the pair of two-state switches this replaces ended up saying.
 */
function MobileModeToggle({
  mode,
  onChange,
  fieldCount,
  animate,
}: {
  mode: MobileMode;
  onChange: (mode: MobileMode) => void;
  /** How many fields the page reported. Absent shows Fields with no count. */
  fieldCount?: number;
  animate: boolean;
}) {
  const options: ReadonlyArray<MobileModeOption> = [
    { value: "normal", label: "Normal", icon: MousePointerSquareDashed },
    { value: "fields", label: "Fields", icon: ListTree, badge: fieldCount },
    { value: "preview", label: "Preview", icon: Eye },
  ];
  return (
    <SegmentedControl
      label="Workspace view"
      value={mode}
      onChange={onChange}
      animate={animate}
      options={options}
      // Only ever on the phone strip, which is where the room runs out.
      compact
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
      label="Preview view"
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
