import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
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
import { CANVAS_MAX_WIDTH } from "../EditorCanvas";
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
  }) => ReactNode;
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

  const ease = (properties: string[]) =>
    reducedMotion || skipTransition
      ? undefined
      : properties.map((p) => `${p} ${OPEN_MS}ms ${OPEN_EASE}`).join(", ");

  const [device, setDevice] = useState<CanvasDevice>("desktop");
  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [attachedFieldIds, setAttachedFieldIds] = useState<string[]>([]);
  const [pane, setPane] = useState<WorkspacePane>("editor");

  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const paneScrollRef = useRef<HTMLDivElement>(null);

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

  // Opening the canvas, and switching device, both change the box the page
  // has to fit into. The column also finishes moving a third of a second
  // after the click, and the observer above catches that too.
  useEffect(() => setNeedsFit(true), [device, open]);

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

  // Only the fields view is a picking surface. In the normal view the page is
  // there to be read and clicked through like a page, so a click on it does
  // not mean "I want to edit this".
  const isPicking = view === "fields";

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
  const viewToggle = page ? (
    <ViewToggle
      view={view}
      onChange={onViewChange}
      fieldCount={Object.keys(page.fields).length}
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
        {view === "fields" && open && fieldsColumn
          ? fieldsColumn
          : moduleColumn}
      </div>
    </div>
  );

  const canvasPane = hasCanvas && (
    <div
      className={cn(
        "relative h-full overflow-hidden rounded-xl border border-border-float bg-bg-float-raised",
      )}
    >
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
    <div className="absolute inset-0 flex overflow-hidden bg-bg-canvas">
      <div
        style={{
          width: open ? COLUMN_WIDTH : "100%",
          transition: ease(["width"]),
        }}
        className="relative h-full min-w-0 shrink-0"
      >
        {column}
      </div>
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
