import { useState } from "react";
import { CanvasFrame } from "../shell/canvas/CanvasFrame";
import {
  CanvasPreviewNotice,
  type CanvasPreviewStatus,
} from "../shell/canvas/CanvasPreviewNotice";

/**
 * The page a route divider names, beside the sketch: the Studio's own canvas,
 * so it is the page as it is being edited -- a field changed in the Studio,
 * or by the assistant building the sketch, shows here as it does on the
 * canvas, not after a reload.
 */
export function SketchpadPreview({ route }: { route: string | null }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [enableKey, setEnableKey] = useState(0);
  const [status, setStatus] = useState<CanvasPreviewStatus>("connecting");
  if (route === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-secondary">
        Press a page in the sketch to see it here.
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border-primary px-3 py-2">
        <span className="text-xs font-medium text-fg-secondary">Preview</span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-bg-secondary px-2 py-1 text-xs font-semibold text-fg-secondary">
          {route}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-white">
        <CanvasFrame
          key={route}
          url={route}
          width="100%"
          height="100%"
          reloadKey={reloadKey}
          isPicking={false}
          highlightedPath={null}
          enableKey={enableKey}
          onStatusChange={setStatus}
        />
        <CanvasPreviewNotice
          status={status}
          attempt={`${route}:${reloadKey}:${enableKey}`}
          onEnable={() => setEnableKey((key) => key + 1)}
          onReload={() => setReloadKey((key) => key + 1)}
        />
      </div>
    </div>
  );
}
