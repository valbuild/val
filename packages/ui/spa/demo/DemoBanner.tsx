import { Compass, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/designSystem/button";
import { cn } from "../components/designSystem/cn";
import { CLEAR_OF_BOTTOM_BARS } from "../components/shell/MobileChrome";
import { useShellBreakpoint } from "../components/shell/useShellBreakpoint";

/** Where "Create your own project" goes. */
export const DEMO_CREATE_PROJECT_URL = "https://val.build/docs/create";

/**
 * What the demo IS, always on screen: a card in the corner.
 *
 * Floating rather than a bar across the top, because the shell lays its bars
 * out absolutely and a row above them would push every one of them down. It
 * can be folded away, never closed: someone coming back to the tab after
 * lunch should still be able to tell that nothing they did here was saved
 * anywhere but this tab.
 */
export function DemoBanner({
  onReset,
  onStartTour,
}: {
  /** Forget every edit and load the demo again. */
  onReset: () => void;
  onStartTour: () => void;
}) {
  const [folded, setFolded] = useState(false);
  const breakpoint = useShellBreakpoint();
  return (
    <div
      className={cn(
        "fixed z-window max-w-[calc(100vw-2rem)]",
        // Clear of the left rail on desktop, as the status bar is.
        breakpoint === "desktop" ? "left-[4.75rem]" : "left-3",
        CLEAR_OF_BOTTOM_BARS,
      )}
      data-val-tour="demo"
    >
      {folded ? (
        <Button
          size="xs"
          variant="secondary"
          className="rounded-full shadow-md"
          onClick={() => setFolded(false)}
        >
          Demo
        </Button>
      ) : (
        <div
          role="region"
          aria-label="About this demo"
          className="w-[300px] max-w-full rounded-lg border border-border-primary bg-bg-primary p-3 text-sm text-fg-primary shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">This is a demo of Val</p>
            <button
              type="button"
              aria-label="Fold the demo card"
              className="text-fg-tertiary hover:text-fg-primary"
              onClick={() => setFolded(true)}
            >
              <X size={14} />
            </button>
          </div>
          <p className="mt-1 text-fg-secondary">
            Edit anything. Your changes stay in this browser tab: nothing is
            saved anywhere else, and closing the tab starts over.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="xs" variant="secondary" onClick={onStartTour}>
              <Compass size={14} className="mr-1" />
              Tour
            </Button>
            <Button size="xs" variant="secondary" onClick={onReset}>
              <RotateCcw size={14} className="mr-1" />
              Reset demo
            </Button>
            <Button size="xs" asChild>
              <a
                href={DEMO_CREATE_PROJECT_URL}
                target="_blank"
                rel="noreferrer"
              >
                Create your own project
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
