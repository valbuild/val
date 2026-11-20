import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ChevronRight, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "../../designSystem/cn";
import { useDismissOnOutsidePointer } from "../useDismissOnOutsidePointer";
import { Spinner } from "../../designSystem/spinner";

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
 * How long the preview may be unavailable before anything is said, and how
 * it is fixed in the meantime.
 *
 * Everything that stops the canvas working also happens on the way to it
 * working: `next dev` compiling a route for the first time, the enable
 * redirect in flight, the bridge mounting after hydration. And the commonest
 * thing actually wrong -- preview mode off -- is fixed by one navigation the
 * Studio can make itself. So for the first {@link PreviewRecoveryTiming.retryForMs}
 * the canvas fixes it rather than asking: every
 * {@link PreviewRecoveryTiming.retryEveryMs} it turns preview mode on again,
 * whenever the page has said it is off or has not answered at all. Only a
 * page that is still not working after that gets the message with the button
 * and the explanation.
 *
 * Nothing is SAID for the first {@link PreviewRecoveryTiming.quietMs}: a
 * spinner shows the page is loading, and that is all. After it, the pill says
 * what is being done -- loading, or turning preview mode on -- until the
 * retries run out.
 */
export type PreviewRecoveryTiming = {
  /** Only a spinner before this: no words, no Details. */
  quietMs: number;
  /** How often preview mode is turned on again while the page says it is off. */
  retryEveryMs: number;
  /** How long it is turned on automatically before the person is asked to. */
  retryForMs: number;
};

export const PREVIEW_RECOVERY: PreviewRecoveryTiming = {
  quietMs: 10_000,
  retryEveryMs: 5_000,
  retryForMs: 30_000,
};

/**
 * When the warning arrives: once the automatic retries have run out.
 *
 * Kept under its old name because the e2e suites and the tests wait on it.
 */
export const PREVIEW_WARNING_DELAY_MS = PREVIEW_RECOVERY.retryForMs;

/**
 * Where an episode of the preview not working has got to.
 *
 * - `loading`: the first seconds, a spinner and nothing else.
 * - `recovering`: still being fixed automatically, and said so.
 * - `gave-up`: the automatic attempts are over; the person is asked.
 */
export type PreviewRecoveryPhase = "loading" | "recovering" | "gave-up";

export function previewRecoveryPhase(
  elapsedMs: number,
  timing: PreviewRecoveryTiming,
): PreviewRecoveryPhase {
  if (elapsedMs >= timing.retryForMs) return "gave-up";
  if (elapsedMs >= timing.quietMs) return "recovering";
  return "loading";
}

/**
 * Whether to turn preview mode on now, without being asked.
 *
 * Only when the page has given a reason -- it answered that preview mode is
 * off, or it did not answer at all -- and never while a document is on its
 * way (`connecting`, `enabling`): navigating the frame then would cut short
 * the load that was about to answer.
 */
export function shouldAutoEnable({
  status,
  elapsedMs,
  sinceLastEnableMs,
  timing,
}: {
  status: CanvasPreviewStatus;
  elapsedMs: number;
  /** `null` when this episode has not turned it on yet. */
  sinceLastEnableMs: number | null;
  timing: PreviewRecoveryTiming;
}): boolean {
  if (status !== "preview-off" && status !== "no-answer") return false;
  if (elapsedMs >= timing.retryForMs) return false;
  return sinceLastEnableMs === null || sinceLastEnableMs >= timing.retryEveryMs;
}

/**
 * The canvas is not ready — said in a bar, not by covering the page up.
 *
 * This used to be a full-bleed panel over the frame with a blurred backdrop.
 * It stopped the canvas being a canvas: the published page underneath is real
 * and worth looking at, scrolling and reading, and none of that was possible
 * while the thing explaining why it could not be EDITED was in the way.
 *
 * So: a pill at the top of the viewport, the page untouched behind it, and the
 * long explanation behind a disclosure for the person who wants it. What the
 * pill holds follows {@link PreviewRecoveryPhase}: a spinner alone, then a
 * spinner with what is being done, then -- if the automatic fix did not work --
 * a warning with the button that turns preview mode on.
 */
export function CanvasPreviewNotice({
  status,
  attempt,
  onEnable,
  onReload,
  timing = PREVIEW_RECOVERY,
}: {
  status: CanvasPreviewStatus;
  /**
   * Changes whenever the PERSON asks for a new document: a reload.
   *
   * It restarts the episode -- the quiet seconds, the automatic retries --
   * because the status alone cannot say so: reloading a page that has given
   * up at `no-answer` leaves it at `no-answer`. The notice's own automatic
   * enables must not move it, or the retries would never run out.
   */
  attempt?: string | number;
  /** Turn preview mode on: sets the cookie and draft mode in one navigation. */
  onEnable: () => void;
  /** Ask for the page again. */
  onReload: () => void;
  /**
   * The clock, for the stories and tests: thirty seconds is longer than
   * anyone reviewing a design will wait. The app never passes it.
   */
  timing?: PreviewRecoveryTiming;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { phase, restart } = usePreviewRecovery(
    status,
    attempt,
    onEnable,
    timing,
    containerRef,
  );
  const isWarning = phase === "gave-up";
  const [isOpen, setIsOpen] = useState(false);
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

  const label = describePreviewStatus(status, phase);
  /**
   * The button, once the automatic attempts are over and only then.
   *
   * Before it, the Studio is already doing what the button would do, every
   * few seconds: a button then is a second way to do the thing in progress.
   * Pressing it starts the automatic attempts over, because it is the person
   * asking for exactly that.
   */
  const hasFix =
    isWarning && (status === "preview-off" || status === "no-answer");
  /**
   * Whether to say what is KNOWN rather than what is safe to say in passing.
   *
   * The pill withholds a diagnosis until the retries run out, because it is
   * ambient: it appears without being asked for, over a page that is very
   * often just compiling. The panel is not ambient -- it was opened,
   * deliberately, by someone asking what is going on -- so it says what the
   * page reported.
   */
  const known = isWarning || status === "preview-off" || status === "no-answer";
  return (
    /*
     * `pointer-events-none` on the layer, `auto` on the pill: the page behind
     * stays usable while this is on screen. A full-size layer that swallowed
     * the pointer would be the old blocking panel again, with nothing drawn on
     * it.
     *
     * A column, and the LAYER is what the panel is measured against: the
     * canvas pane can be 280px wide and is `overflow-hidden`, so the panel is
     * stacked under the pill and `max-w-full` is the pane's own width.
     */
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-x-0 top-0 z-window flex flex-col items-center gap-1 p-2"
    >
      <div
        className={cn(
          "pointer-events-auto flex max-w-full items-center gap-1.5 rounded-lg border shadow-sm",
          "text-[0.6875rem]",
          phase === "loading" ? "p-1.5" : "px-2 py-1",
          isWarning
            ? "border-border-warning-primary bg-bg-warning-primary text-fg-warning-primary"
            : "border-border-float bg-bg-float text-fg-secondary",
        )}
      >
        {/*
         * `status`, so the change is announced once it settles rather than on
         * every re-render of a spinner. While loading the words are not drawn
         * -- the spinner is the whole message -- but they are still read out,
         * since a spinner announces nothing.
         *
         * `min-w-0`, because the controls beside this are `shrink-0`: without
         * it the label refuses to shrink to its own `truncate` and the pill
         * grows past a narrow pane.
         */}
        <span className="flex min-w-0 items-center gap-1.5" role="status">
          {isWarning ? (
            <TriangleAlert size={12} className="shrink-0" aria-hidden />
          ) : (
            <Spinner size={12} aria-hidden />
          )}
          <span className={cn("truncate", phase === "loading" && "sr-only")}>
            {label}
          </span>
        </span>
        {hasFix && (
          <button
            type="button"
            onClick={() => {
              restart();
              onEnable();
            }}
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 font-medium",
              "bg-bg-brand-primary text-fg-brand-primary",
              "hover:bg-bg-brand-primary-hover",
            )}
          >
            Turn on preview mode
          </button>
        )}
        {phase !== "loading" && (
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
        )}
      </div>
      {isOpen && phase !== "loading" && (
        <div
          className={cn(
            "pointer-events-auto w-80 max-w-full",
            "rounded-lg border border-border-float bg-bg-float p-3 text-left shadow-xl",
            /*
             * Scrolls itself rather than being clipped: the canvas viewport is
             * `overflow-hidden`, and with the setup instructions open the
             * links are at the bottom.
             */
            "max-h-[min(70vh,32rem)] overflow-y-auto scrollbar-slim",
          )}
        >
          <h3 className="text-xs font-medium text-fg-primary">
            {describePreviewStatus(status, known ? "gave-up" : phase)}
          </h3>
          <p className="mt-1.5 text-[0.6875rem] leading-relaxed text-fg-secondary">
            {explainPreviewStatus(status, known, isWarning)}
          </p>
          {/*
           * The developer's checklist, wherever something is wrong: someone
           * whose preview mode will not stay on lands back on `preview-off`,
           * and that is exactly who needs it.
           */}
          <SetupInstructions />
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
  phase: PreviewRecoveryPhase,
): string {
  if (phase !== "gave-up") {
    // Not a diagnosis: the Studio is still fixing it, so the pill says what
    // it is doing rather than what is wrong.
    return status === "connecting"
      ? "Loading the preview…"
      : "Turning on preview mode…";
  }
  if (status === "enabling") return "Still turning on preview mode";
  return status === "preview-off"
    ? "Preview mode is off"
    : "No answer from the page";
}

/** What the disclosure says, which is the whole of the old panel's copy. */
function explainPreviewStatus(
  status: CanvasPreviewStatus,
  known: boolean,
  gaveUp: boolean,
): string {
  if (status === "enabling") {
    return "Preview mode is being turned on: the page is being reloaded through Val's enable endpoint, which sets the cookie and turns on draft mode.";
  }
  if (!known) {
    return "The page has not reported what is on it yet. A route the dev server has not compiled before can take a few seconds the first time it is asked for.";
  }
  const retrying = gaveUp
    ? " Val turned preview mode on several times and it did not stay on."
    : " Val is turning preview mode on again every few seconds.";
  if (status === "preview-off") {
    return (
      "Without preview mode the canvas shows the published page, and nothing on it can be selected or edited. The page itself is fine — you are looking at the real thing, just not at your unpublished changes." +
      retrying
    );
  }
  return (
    "The page loaded but did not report back. It may be an older version of Val, preview mode may have been turned off elsewhere, or the app may not be wired up yet." +
    retrying
  );
}

/**
 * The clock of one episode of the preview not working, and the automatic
 * enables that run on it.
 *
 * An episode begins when the status stops being `live` (or the notice mounts
 * on a page that is not), and again when the person reloads or presses the
 * button. It does NOT begin again when the status moves between the states
 * that are not live: `connecting` becoming `preview-off`, or an automatic
 * enable going through `enabling`, is the same episode -- restarting there is
 * how the retries would never run out and the message never arrive.
 */
function usePreviewRecovery(
  status: CanvasPreviewStatus,
  attempt: string | number | undefined,
  onEnable: () => void,
  timing: PreviewRecoveryTiming,
  /** Anything in the canvas's own document, to ask it what has focus. */
  near: RefObject<HTMLElement | null>,
): { phase: PreviewRecoveryPhase; restart: () => void } {
  const live = status === "live";
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const lastEnableAt = useRef<number | null>(null);
  const restart = useCallback(() => {
    setStartedAt(Date.now());
    lastEnableAt.current = null;
  }, []);
  // Leaving `live` begins an episode.
  const wasLive = useRef(live);
  useEffect(() => {
    if (wasLive.current && !live) restart();
    wasLive.current = live;
  }, [live, restart]);
  // So does a reload: a new attempt the status cannot report.
  const firstAttempt = useRef(attempt);
  useEffect(() => {
    if (attempt === firstAttempt.current) return;
    firstAttempt.current = attempt;
    restart();
  }, [attempt, restart]);

  // A tick while not live, to move between phases and to retry on time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (live) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, [live, startedAt]);

  const elapsedMs = Math.max(0, now - startedAt);
  const phase = previewRecoveryPhase(elapsedMs, timing);

  const enable = useRef(onEnable);
  enable.current = onEnable;
  useEffect(() => {
    if (live) return;
    // Someone is using the page -- typing into a sign-in form the site sent
    // the canvas to, say. Turning preview mode on navigates the frame and
    // would throw away what they typed, so it waits for the next tick.
    if (frameHasFocus(near.current)) return;
    const at = Date.now();
    if (
      shouldAutoEnable({
        status,
        elapsedMs: at - startedAt,
        sinceLastEnableMs:
          lastEnableAt.current === null ? null : at - lastEnableAt.current,
        timing,
      })
    ) {
      lastEnableAt.current = at;
      enable.current();
    }
  }, [live, status, now, startedAt, timing, near]);

  return { phase, restart };
}

/** Whether a frame beside `node` -- the canvas's page -- has the focus. */
function frameHasFocus(node: Element | null): boolean {
  const root = node?.getRootNode();
  const active =
    root instanceof ShadowRoot || root instanceof Document
      ? root.activeElement
      : null;
  return active instanceof HTMLIFrameElement;
}

/**
 * What a DEVELOPER needs when the canvas will not work.
 *
 * The most likely cause of silence is not a fault at all — it is an app that has
 * not been wired up: no `ValProvider` in the root layout, or one that is not
 * above the page being previewed. That is a five-line fix and completely opaque
 * from this side of the iframe, so the answer is worth having on screen —
 * offered in every state the canvas is not working in, because the state
 * someone is stuck in is rarely the one they would have guessed.
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
