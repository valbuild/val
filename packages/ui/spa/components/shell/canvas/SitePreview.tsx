import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ModuleFilePath } from "@valbuild/core";
import { cn } from "../../designSystem/cn";
import { CanvasToolbar } from "./CanvasToolbar";
import {
  CanvasPinch,
  CanvasWindow,
  CanvasWindowHandle,
  ZOOM_STEP,
} from "./CanvasWindow";
import { CanvasRouteBar } from "./CanvasRouteBar";
import { CanvasCodeChangedNotice } from "./CanvasCodeChangedNotice";
import {
  CanvasPreviewNotice,
  CanvasPreviewStatus,
} from "./CanvasPreviewNotice";
import {
  CANVAS_DEVICE_HEIGHTS,
  CANVAS_DEVICE_WIDTHS,
  CanvasDevice,
  CanvasPoint,
  CanvasTransform,
} from "./types";

/**
 * What the preview hands the page it holds: the size to lay it out at, and
 * the ways the page reports back.
 *
 * The page is rendered by the caller because only the caller knows what it
 * is -- the running site in a `CanvasFrame` in the app, a demo page in
 * Storybook -- and what a pick on it means.
 */
export type SitePreviewViewport = {
  device: CanvasDevice;
  /**
   * Show the page at another width, exactly as the toolbar's device switch
   * does: the assistant's `interact_page` uses it, so there is one way the
   * preview is sized. Absent where the width is chosen elsewhere (`device`).
   */
  setDevice?: (device: CanvasDevice) => void;
  width: number;
  height: number;
  /**
   * Bumped every time the reload control is used.
   *
   * Handed over rather than kept here because only the caller knows what
   * reloading means for what it rendered -- for a frame it is a remount, and
   * the caller is the one holding its `key`.
   */
  reloadKey: number;
  /**
   * Whether a click on the page picks the element under it. Passed down
   * rather than taken as a prop by the page, so there is one answer.
   */
  isPicking: boolean;
  /** Ask for the page again, as the reload control does. */
  onRequestReload: () => void;
  /**
   * Report that the page is re-rendering because of an edit.
   *
   * Only the page knows: its client store updates at once, and anything
   * rendered on the server changes only after a `router.refresh()` and its
   * round trip. Unsaid, the gap between typing and the preview changing looks
   * like the preview being stuck rather than busy.
   */
  onRefreshingChange: (isRefreshing: boolean) => void;
  /**
   * A two-finger gesture that landed on the page.
   *
   * The page is a frame and a frame keeps its own touches, so a pinch there
   * is invisible here unless the page relays it. See `ValCanvasBridge`.
   */
  onPinch: (gesture: CanvasPinch) => void;
  /** A ctrl/cmd + wheel zoom over the page, relayed for the same reason. */
  onZoom: (factor: number, center: CanvasPoint) => void;
  /**
   * Bumped when the notice's "Turn on preview mode" is used, or when the
   * notice retries by itself.
   *
   * The button is in the notice, which sits outside the zoom transform, and
   * the act is a navigation of whatever is in the preview -- so, like
   * `reloadKey`, it goes to the thing that can perform it.
   */
  enableKey: number;
  /**
   * How the page is getting on.
   *
   * Reported up here because the notice must NOT be inside the zoom
   * transform: at auto-fit on a narrow pane that is a status bar rendered at
   * half size. See `CanvasPreviewNotice`.
   */
  onStatusChange: (status: CanvasPreviewStatus) => void;
  /**
   * Modules the page could not show the Studio's content of, for their
   * schema: said beside the preview notice, with a reload. See
   * `CanvasCodeChangedNotice`.
   */
  onCodeChanged: (modules: ModuleFilePath[]) => void;
};

export type SitePreviewProps = {
  /** The page, at the size the device switch asks for. */
  renderPage: (viewport: SitePreviewViewport) => ReactNode;
  /**
   * The route the preview is showing.
   *
   * With `onRouteChange` it is an address bar that can be typed in; without a
   * route there is no address bar -- the demo page is on no route.
   */
  route?: string;
  onRouteChange?: (route: string) => void;
  /** Routes offered as suggestions in the address bar. */
  routes?: readonly string[];
  /**
   * At the end of the address bar's row: what the place holding the preview
   * adds to it, such as the way to close it.
   */
  headerEnd?: ReactNode;
  /** The width the page starts at. The switch is the person's after that. */
  initialDevice?: CanvasDevice;
  /**
   * The width, chosen elsewhere: Review's comparison, where one switch sets
   * both sides. Given, the toolbar has no widths of its own.
   */
  device?: CanvasDevice;
  /**
   * Where the preview was left looking, from a link.
   *
   * Applied instead of fitting the page: a link that says where to look
   * should not be overruled by the preview's own idea of a good default.
   */
  initialTransform?: CanvasTransform | null;
  /** Reported as the preview is panned and zoomed, so a link can carry it. */
  onTransformChange?: (transform: CanvasTransform) => void;
  /**
   * Whether a click on the page picks the field it hits.
   *
   * Only told, never switched here: the switch is the Select of the pane the
   * pick is for, in that pane's header (`SelectButton`), so the button that
   * is pressed is the one saying what a click on the page will do.
   */
  isPicking?: boolean;
  /**
   * Whether the page can be loaded again. Not the demo page, which renders
   * from data that is already live and has nothing to fetch.
   */
  reloadable?: boolean;
  /** The reload control was used: the page is being loaded again. */
  onReload?: () => void;
  /** Around the page, under its shadow: where a click off a field lands. */
  onPageClick?: () => void;
  /**
   * Code mode: the frame is in the proposal's colour, one of the subtle
   * ways the Studio says what the assistant can change.
   */
  tone?: "proposal";
  /**
   * On a phone: the controls docked to the bottom of the page's card, as
   * the Sketchpad's tools are to its page (`CanvasToolbar`'s `docked`).
   */
  docked?: boolean;
  className?: string;
};

/**
 * The site, as the Studio previews it: an address bar, the page, and the
 * page's controls -- device widths, zoom, fit and reload -- in that
 * order, each on its own row.
 *
 * One component for every place the site is shown beside the work: the
 * content editor's canvas and the Sketchpad's preview, so the two have the
 * same controls and do the same thing with them. What differs between those
 * places -- what a pick opens, what closes the preview, where the route comes
 * from -- is passed in; how the page is looked at is decided here.
 *
 * All three rows used to float on top of the page. That is fine over a mockup
 * and wrong over a real site, because a real site puts its most important
 * things exactly where the chrome was sitting: the address bar covered the
 * header and the toolbar covered the footer. Docking them costs about 80px of
 * page height and gives back the two edges, which is the right trade for a
 * thing whose whole job is to be looked at.
 *
 * Exists exactly while it is on screen: the caller mounts it when the preview
 * opens and unmounts it when it closes, because in the app the page is the
 * running site and a hidden one is still a second copy of it running in this
 * tab.
 */
export function SitePreview({
  renderPage,
  route,
  onRouteChange,
  routes,
  headerEnd,
  initialDevice = "desktop",
  device: chosenDevice,
  initialTransform,
  onTransformChange,
  isPicking = false,
  reloadable = true,
  onReload,
  onPageClick,
  tone,
  docked = false,
  className,
}: SitePreviewProps) {
  /**
   * Which width the page is shown at.
   *
   * The starting value only, so the switch stays the person's after that --
   * including the perfectly reasonable "check the desktop layout from my
   * phone".
   */
  const [ownDevice, setOwnDevice] = useState<CanvasDevice>(initialDevice);
  const device = chosenDevice ?? ownDevice;
  /**
   * How far the page is zoomed.
   *
   * Only the zoom: where the window is scrolled belongs to the browser, and
   * is read back off the element rather than mirrored here. Keeping it in
   * state as well would mean a render of the whole preview on every frame of
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

  const canvasWindowRef = useRef<CanvasWindowHandle>(null);
  const pageWidth = CANVAS_DEVICE_WIDTHS[device];

  /**
   * Whether the window should keep the page at the width of the pane.
   *
   * The window does the fitting -- it is the only thing that knows its own
   * size -- but whether a fit is still WANTED is decided here, and it stops
   * being wanted the moment someone zooms. A link that names a position has
   * already answered the question fitting exists to answer, so it is not
   * overruled by one.
   */
  const [autoFit, setAutoFit] = useState(initialTransform == null);

  /**
   * Back to the default view: the page at the pane's width, from the top.
   *
   * Both halves, and the second is why this is a call rather than only
   * `setAutoFit(true)`. Holding the fit is the window's own business and
   * deliberately does not move the window -- a page someone scrolled down
   * must not jump to the top because the divider moved -- so the top is
   * pinned here, at the moments a fit is ASKED for: switching device,
   * reloading, and the fit button. (Opening is a mount, and a mounted window
   * starts at the top.)
   *
   * `setAutoFit(true)` on its own also does nothing at all when the fit is
   * already armed, which is exactly the state the fit button is pressed in
   * after scrolling: no state changed, so nothing re-ran, so the button did
   * nothing.
   */
  const fitPage = useCallback(() => {
    setAutoFit(true);
    canvasWindowRef.current?.fit();
  }, []);

  /**
   * Switching device changes the box the page has to fit into.
   *
   * A CHANGE in it, not merely a render in which it has a value: a link that
   * names a position is applied on the first render, and anything that
   * treats that render as a transition overwrites exactly what the link was
   * carrying. The previous device is a ref updated inside the effect rather
   * than a flag the first run consumes, because StrictMode runs an effect
   * twice on mount and a consumed flag turns the second run into a spurious
   * "the device changed".
   */
  const lastDevice = useRef(device);
  useEffect(() => {
    if (lastDevice.current === device) return;
    lastDevice.current = device;
    fitPage();
  }, [device, fitPage]);

  // The preview shows a document Val does not render: a server component
  // re-reads content when the page is requested, so some changes only arrive
  // on a reload.
  const [reloadKey, setReloadKey] = useState(0);
  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const reload = useCallback(() => {
    setReloadKey((key) => key + 1);
    onReloadRef.current?.();
    // A reloaded page is the page from the beginning again, so the view it
    // is shown at is the default one again.
    fitPage();
  }, [fitPage]);

  /**
   * A zoom someone asked for ends the fit.
   *
   * Answered once, by the window, rather than at each of the ways of asking:
   * the buttons and the relayed gestures come through here, but a ctrl/cmd +
   * wheel over the preview's background never leaves the window at all.
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
  const onZoom = useCallback(
    (factor: number, center: CanvasPoint) => zoomByUser(factor, center),
    [zoomByUser],
  );

  /** See `SitePreviewViewport.onRefreshingChange`. */
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * How the page is getting on, and the way to fix it.
   *
   * `live` to begin with, so the demo page -- which reports nothing, because
   * Storybook has no frame to report -- shows no notice at all.
   */
  const [previewStatus, setPreviewStatus] =
    useState<CanvasPreviewStatus>("live");
  /** What the page could not read for its schema (`codeChanged`). */
  const [codeChanged, setCodeChanged] = useState<ModuleFilePath[]>([]);
  const [enableKey, setEnableKey] = useState(0);

  const routeBar = route !== undefined && onRouteChange && (
    <CanvasRouteBar
      value={route}
      routes={routes ?? []}
      onChange={onRouteChange}
      // Takes the row it is on, up to a width where a real route is readable
      // without the field running the length of a desk.
      className="min-w-0 flex-1 md:max-w-[28rem]"
    />
  );

  const toolbar = (
    <CanvasToolbar
      className={docked ? undefined : "max-w-full"}
      docked={docked}
      device={device}
      onDeviceChange={chosenDevice === undefined ? setOwnDevice : undefined}
      scale={scale}
      onZoomIn={() => zoomByUser(ZOOM_STEP, null)}
      onZoomOut={() => zoomByUser(1 / ZOOM_STEP, null)}
      onFit={fitPage}
      isRefreshing={isRefreshing}
      onReload={reloadable ? reload : undefined}
    />
  );

  return (
    <div
      data-val-site-preview=""
      className={cn("flex h-full min-h-0 flex-col gap-2", className)}
    >
      {(routeBar || headerEnd) && (
        <div className="flex shrink-0 items-center gap-2">
          {routeBar}
          {headerEnd}
        </div>
      )}
      <div
        data-val-preview-tone={tone}
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-xl border bg-bg-float-raised",
          docked && "flex flex-col",
          tone === "proposal"
            ? "border-border-proposal"
            : "border-border-float",
        )}
      >
        {/*
         * Above the page and outside the zoom, which is the whole reason the
         * status is lifted out of the frame. It used to be a panel over the
         * frame with a blurred backdrop, so the published page -- which is
         * real, and worth reading -- was unreachable behind an explanation of
         * why it could not be edited.
         */}
        <CanvasPreviewNotice
          status={previewStatus}
          /*
           * Which attempt this is: the reloads the person asked for, and the
           * route -- another page is another attempt. Not the enables,
           * because the notice makes those itself while it retries, and they
           * must not restart the clock that decides when it stops. Reloading
           * a page that has given up leaves it at `no-answer`, so the status
           * alone cannot say a new attempt began.
           */
          attempt={`${route ?? ""}:${reloadKey}`}
          onEnable={() => setEnableKey((key) => key + 1)}
          onReload={reload}
        />
        {previewStatus === "live" && (
          <CanvasCodeChangedNotice modules={codeChanged} onReload={reload} />
        )}
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
          className={docked ? "min-h-0 flex-1" : "h-full"}
        >
          <div className="shadow-2xl" onClick={onPageClick}>
            {renderPage({
              device,
              ...(chosenDevice === undefined
                ? { setDevice: setOwnDevice }
                : {}),
              width: pageWidth,
              height: CANVAS_DEVICE_HEIGHTS[device],
              reloadKey,
              isPicking,
              onRequestReload: reload,
              onRefreshingChange: setIsRefreshing,
              onPinch,
              onZoom,
              enableKey,
              onStatusChange: setPreviewStatus,
              onCodeChanged: setCodeChanged,
            })}
          </div>
        </CanvasWindow>
        {docked && toolbar}
      </div>

      {!docked && <div className="flex shrink-0 justify-center">{toolbar}</div>}
    </div>
  );
}
