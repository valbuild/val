import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { useDismissOnOutsidePointer } from "../useDismissOnOutsidePointer";

/**
 * How the canvas is getting on with the page it is showing.
 *
 * `connecting` is not the same as `no-answer`: a page that has not spoken yet
 * might be about to, and `preview-off` is the page having answered that it is
 * rendering published content. Reported by `CanvasFrame`, which owns the
 * message protocol; rendered here, because this notice sits OUTSIDE the zoom
 * transform and the frame is inside it.
 */
export type CanvasPreviewStatus =
  | "connecting"
  | "enabling"
  | "no-answer"
  | "preview-off"
  | "live";

/**
 * How long the canvas looks like it is loading before it looks like a problem.
 *
 * Everything that stops the canvas working also happens transiently on the way
 * to it working: `next dev` compiling a route for the first time, the enable
 * redirect being in flight, the bridge mounting after hydration. Twenty seconds
 * is well past all of those and well short of someone giving up, so a spinner
 * that turns into a warning describes the situation without ever having accused
 * a page that was simply slow.
 */
export const PREVIEW_WARNING_DELAY_MS = 20000;

/**
 * The canvas is not ready — said in a bar, not by covering the page up.
 *
 * This used to be a full-bleed panel over the frame with a blurred backdrop.
 * It stopped the canvas being a canvas: the published page underneath is real
 * and worth looking at, scrolling and reading, and none of that was possible
 * while the thing explaining why it could not be EDITED was in the way. Worse,
 * the panel appeared during ordinary slowness — a first `next dev` compile —
 * so the normal path to a working canvas went through a screen that looked
 * like a failure.
 *
 * So: a pill at the top of the viewport, the page untouched behind it, and the
 * long explanation behind a disclosure for the person who wants it. The icon
 * carries the state — a spinner for {@link PREVIEW_WARNING_DELAY_MS}, then a
 * warning, with the colours following — because that is the part someone reads
 * without stopping what they are doing.
 */
export function CanvasPreviewNotice({
  status,
  attempt,
  onEnable,
  onReload,
  warnAfterMs = PREVIEW_WARNING_DELAY_MS,
}: {
  status: CanvasPreviewStatus;
  /**
   * Changes whenever the canvas asks for a NEW document - a reload, an enable.
   *
   * The clock cannot be driven by the status alone. Reloading a page that is
   * already `connecting` (or one that has given up, at `no-answer`) starts a
   * fresh attempt with the same status, so nothing here changes and the old
   * timer runs on: the warning then arrives seconds into an attempt that has
   * barely begun, describing the one before it.
   */
  attempt?: string | number;
  /** Turn preview mode on: sets the cookie and draft mode in one navigation. */
  onEnable: () => void;
  /** Ask for the page again. */
  onReload: () => void;
  /**
   * How long the spinner runs before this becomes a warning.
   *
   * A prop only so a story can show the far end of the clock: twenty seconds
   * is longer than anyone looking at a design will wait, and a story that
   * re-mounts to get there only restarts the wait. The app never passes it.
   */
  warnAfterMs?: number;
}) {
  const isWarning = useWarningAfterDelay(status, attempt, warnAfterMs);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setIsOpen(false), []);
  useDismissOnOutsidePointer(containerRef, isOpen, close);
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);
  // Nothing to say once the canvas works, and the details close with it so a
  // page that sorts itself out does not leave an explanation of a past problem
  // on screen.
  useEffect(() => {
    if (status === "live") setIsOpen(false);
  }, [status]);
  if (status === "live") return null;

  const label = describePreviewStatus(status, isWarning);
  return (
    /*
     * `pointer-events-none` on the layer, `auto` on the pill.
     *
     * The whole point is that the page behind stays usable: it can be
     * scrolled, read and clicked while this is on screen. A full-size
     * transparent layer that swallowed the pointer would be the old blocking
     * panel again, with nothing drawn on it.
     */
    /*
     * A column, and the LAYER is what the panel is measured against.
     *
     * The panel used to be absolutely positioned against the pill and capped at
     * `100vw`, which is the browser's viewport - not this one. The canvas pane
     * can be 280px wide and it is `overflow-hidden`, so a 20rem panel was
     * clipped and took the setup checklist and Reload with it. Stacked in a
     * column under the pill, `max-w-full` is the canvas viewport's own width,
     * which is the constraint that was being violated.
     */
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-x-0 top-0 z-window flex flex-col items-center gap-1 p-2"
    >
      <div
        className={cn(
          "pointer-events-auto flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 shadow-sm",
          "text-[0.6875rem]",
          isWarning
            ? "border-border-warning-primary bg-bg-warning-primary text-fg-warning-primary"
            : "border-border-float bg-bg-float text-fg-secondary",
        )}
      >
        {/*
         * `status`, so the change is announced once it settles rather than
         * on every re-render of a spinner. The icon is `aria-hidden`: it says
         * the same thing as the words beside it.
         */}
        {/*
         * `min-w-0`, because the two controls beside this are `shrink-0`: a
         * flex item's default minimum is its content, so without this the
         * label refuses to shrink to its own `truncate` and the pill grows
         * past the pane instead - taking the controls out of reach on a
         * narrow canvas.
         */}
        <span className="flex min-w-0 items-center gap-1.5" role="status">
          {isWarning ? (
            <TriangleAlert size={12} className="shrink-0" aria-hidden />
          ) : (
            <Loader2 size={12} className="shrink-0 animate-spin" aria-hidden />
          )}
          <span className="truncate">{label}</span>
        </span>
        {/*
         * The one-click fix, on the pill rather than behind the disclosure.
         *
         * Only once there is a DIAGNOSIS: the page has answered that it is
         * not in draft mode, or it has stopped answering at all. During the
         * first seconds - a route compiling, an enable redirect in flight -
         * there is nothing to fix and a button saying so would be the
         * accusation the pill is careful not to make. Both of those states
         * are fixed by the same navigation, which is why the old panel
         * offered this button for both.
         */}
        {(status === "preview-off" || status === "no-answer") && (
          <button
            type="button"
            onClick={onEnable}
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-medium",
              "bg-bg-brand-primary text-fg-brand-primary",
              "hover:bg-bg-brand-primary-hover",
            )}
          >
            Turn on preview mode
          </button>
        )}
        {status === "enabling" && (
          <span className="inline-flex shrink-0 items-center gap-1 px-1 font-medium">
            <Loader2 size={11} className="animate-spin" aria-hidden />
            Turning on…
          </span>
        )}
        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          className={cn(
            "inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 font-medium",
            "hover:bg-bg-float-raised",
            isWarning
              ? "text-fg-warning-primary-alt hover:bg-bg-warning-primary-hover"
              : "text-fg-primary",
          )}
        >
          Details
          <ChevronRight
            size={11}
            aria-hidden
            className={cn("transition-transform", isOpen && "rotate-90")}
          />
        </button>
      </div>
      {isOpen && (
        <div
          className={cn(
            "pointer-events-auto w-80 max-w-full",
            "rounded-lg border border-border-float bg-bg-float p-3 text-left shadow-xl",
            /*
             * Scrolls itself rather than being clipped. The canvas viewport
             * is `overflow-hidden` - it has to be, the page inside it is
             * zoomed and panned - so a panel taller than the pane loses its
             * bottom, and with the setup instructions open that is where the
             * links are.
             */
            "max-h-[min(70vh,32rem)] overflow-y-auto scrollbar-slim",
          )}
        >
          <h3 className="text-xs font-medium text-fg-primary">{label}</h3>
          <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-fg-secondary">
            {explainPreviewStatus(status, isWarning)}
          </p>
          {/*
           * The developer's checklist, where the page never answered. Folded
           * away for the same reason it always was: most people looking at
           * this are editors, for whom a code snippet is noise and slightly
           * alarming, and the developer they will ask is the one who needs
           * it.
           */}
          {(status === "no-answer" || status === "connecting") && (
            <SetupInstructions />
          )}
          {/*
           * Reload only. Turning preview mode on is the ONE thing most
           * people here need, so it is on the pill itself - see above -
           * rather than a click away behind this. A second copy of it here
           * would be a second thing to find and the same act.
           */}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onReload}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[0.6875rem] font-medium",
                "text-fg-secondary border border-border-float",
                "hover:bg-bg-float-raised hover:text-fg-primary",
              )}
            >
              <RefreshCw size={11} aria-hidden />
              Reload
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** What the pill says. */
export function describePreviewStatus(
  status: CanvasPreviewStatus,
  isWarning: boolean,
): string {
  if (status === "enabling") {
    return isWarning
      ? "Still turning on preview mode"
      : "Turning on preview mode…";
  }
  // Before the delay is up, nothing is diagnosed: every one of these states is
  // also a step on the way to a working canvas, and naming a fault that is
  // about to fix itself is how the old panel came to look like a failure
  // screen on a slow first compile.
  if (!isWarning) {
    return "Preview is not ready yet";
  }
  return status === "preview-off"
    ? "Preview mode is off"
    : "No answer from the page";
}

/** What the disclosure says, which is the whole of the old panel's copy. */
function explainPreviewStatus(
  status: CanvasPreviewStatus,
  isWarning: boolean,
): string {
  if (status === "enabling") {
    return "Preview mode is being turned on: the page is being reloaded through Val's enable endpoint, which sets the cookie and turns on draft mode.";
  }
  if (!isWarning) {
    return "The page has not reported what is on it yet. A route the dev server has not compiled before can take a few seconds the first time it is asked for.";
  }
  if (status === "preview-off") {
    return "Without preview mode the canvas shows the published page, and nothing on it can be selected or edited. The page itself is fine — you are looking at the real thing, just not at your unpublished changes.";
  }
  return "The page loaded but did not report back. It may be an older version of Val, preview mode may have been turned off elsewhere, or the app may not be wired up yet.";
}

/**
 * Whether the current attempt has been going long enough to call it a problem.
 *
 * The clock has to survive the STATUS changing: `connecting` becoming
 * `preview-off` a moment later is the same attempt with a better diagnosis, not
 * a new one, and restarting the wait there would mean the warning never
 * arrived. So it is keyed on when the attempt began, and only a fresh attempt —
 * a document loading, an enable redirect — moves that.
 */
function useWarningAfterDelay(
  status: CanvasPreviewStatus,
  attempt: string | number | undefined,
  warnAfterMs: number,
): boolean {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const isTrying = status === "connecting" || status === "enabling";
  useEffect(() => {
    if (isTrying) setStartedAt(Date.now());
  }, [isTrying, status]);
  /*
   * And whenever a new document is asked for, whatever the status is doing.
   * A reload while already `connecting` - or after giving up at `no-answer` -
   * is a new attempt that the status cannot report, because it is the same
   * status. See `attempt`.
   */
  const firstAttempt = useRef(attempt);
  useEffect(() => {
    if (attempt === firstAttempt.current) return;
    firstAttempt.current = attempt;
    setStartedAt(Date.now());
  }, [attempt]);
  const [isWarning, setIsWarning] = useState(false);
  useEffect(() => {
    setIsWarning(false);
    const timeout = setTimeout(() => setIsWarning(true), warnAfterMs);
    return () => clearTimeout(timeout);
  }, [startedAt, warnAfterMs]);
  return isWarning;
}

/**
 * What a DEVELOPER needs when the page never answers.
 *
 * The most likely cause of silence is not a fault at all — it is an app that has
 * not been wired up: no `ValProvider` in the root layout, or one that is not
 * above the page being previewed. That is a five-line fix and completely opaque
 * from this side of the iframe, so the answer is worth having on screen.
 *
 * A `details` gives the editor and the developer the right thing without a mode
 * switch, and it is native, so it needs no state and cannot get stuck open.
 */
function SetupInstructions() {
  return (
    <details className="group mt-2 text-left">
      <summary className="cursor-pointer list-none text-[0.6875rem] text-fg-secondary-alt hover:text-fg-primary [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1">
          <ChevronRight
            size={11}
            // `group-open`, not an arbitrary `details[open] &`: the standard
            // variant is what the config is certain to generate.
            className="transition-transform group-open:rotate-90"
            aria-hidden
          />
          Setup instructions
        </span>
      </summary>
      <div className="mt-2 rounded-md border border-border-float bg-bg-secondary p-2.5">
        <p className="text-[0.6875rem] leading-relaxed text-fg-secondary">
          The canvas talks to the page through Val&apos;s provider. If it never
          answers, check that:
        </p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[0.6875rem] leading-relaxed text-fg-secondary">
          <li>
            <code className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-[0.625rem] text-fg-primary">
              ValProvider
            </code>{" "}
            is in the ROOT layout —{" "}
            <code className="font-mono">app/layout.tsx</code> — and therefore
            above every page it should preview. A provider inside a route group
            does not cover the pages outside it.
          </li>
          <li>
            <code className="rounded bg-bg-tertiary px-1 py-0.5 font-mono text-[0.625rem] text-fg-primary">
              ValModulesClient
            </code>{" "}
            is rendered inside it, so the editor can read your schemas.
          </li>
          <li>
            The API route exists at{" "}
            <code className="font-mono">
              app/(val)/api/val/[[...val]]/route.ts
            </code>
            , since preview mode is turned on through it.
          </li>
          <li>
            The page is not served from a different origin than the studio: the
            canvas and the page have to be able to talk to each other.
          </li>
          <li>
            <code className="font-mono">@valbuild/next</code> and{" "}
            <code className="font-mono">@valbuild/core</code> are on the same
            version, in the app and in the editor.
          </li>
        </ol>
        <p className="mt-2 text-[0.6875rem] leading-relaxed text-fg-secondary-alt">
          The setup guide has the whole layout:{" "}
          <a
            href="https://github.com/valbuild/val/blob/main/packages/next/MANUAL_CONFIGURATION.md"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-fg-primary"
          >
            manual configuration
          </a>
          .
        </p>
      </div>
    </details>
  );
}
