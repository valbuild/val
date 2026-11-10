import { useShellBreakpoint } from "../shell/useShellBreakpoint";
import { CanvasFrame } from "../shell/canvas/CanvasFrame";
import { SitePreview } from "../shell/canvas/SitePreview";
import { useBuildEpoch } from "../shell/canvas/useServedBuild";

/**
 * The page a route divider names, beside the sketch: the Studio's own
 * preview, with the canvas's address bar and toolbar, so it is the page as
 * it is being edited -- a field changed in the Studio, or by the assistant
 * building the sketch, shows here as it does on the canvas, not after a
 * reload.
 *
 * Nothing on it can be picked yet: a pick opens a field in the content
 * editor, and the Sketchpad has none beside it.
 */
export function SketchpadPreview({
  route,
  onRouteChange,
  routes,
}: {
  route: string | null;
  /** Show another page: typed into the address bar. */
  onRouteChange?: (route: string) => void;
  /** Pages offered in the address bar. */
  routes?: readonly string[];
}) {
  // A new build served is a new page here too, as on the canvas.
  const buildEpoch = useBuildEpoch();
  const isPhone = useShellBreakpoint() === "mobile";
  if (route === null) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border-float bg-bg-float-raised p-6 text-center text-sm text-fg-secondary">
        Press a page in the sketch to see it here.
      </div>
    );
  }
  return (
    <SitePreview
      route={route}
      onRouteChange={onRouteChange}
      routes={routes}
      initialDevice={isPhone ? "mobile" : "desktop"}
      renderPage={(viewport) => (
        <CanvasFrame
          // Another page is another document, with its own preview mode.
          key={route}
          url={route}
          width={viewport.width}
          height={viewport.height}
          reloadKey={viewport.reloadKey}
          documentKey={buildEpoch}
          isPicking={false}
          highlightedPath={null}
          onPinch={viewport.onPinch}
          onZoom={viewport.onZoom}
          enableKey={viewport.enableKey}
          onStatusChange={viewport.onStatusChange}
          onRefreshingChange={viewport.onRefreshingChange}
        />
      )}
    />
  );
}
