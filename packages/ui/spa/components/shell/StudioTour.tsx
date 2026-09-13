import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Compass, X } from "lucide-react";
import { cn } from "../designSystem/cn";
import { TourStep } from "./studioTour";

/** Where the card is drawn, in shell coordinates. */
type Box = { top: number; left: number; width: number; height: number };

/** How far the card sits from the thing it points at, in px. */
const GAP = 10;
/** Never closer than this to the edge of the shell. */
const MARGIN = 12;
const CARD_WIDTH = 296;

/**
 * The element this step is about, in coordinates relative to `root`.
 *
 * Relative, because the overlay is positioned inside the shell rather than in
 * the page: the Studio is a shadow root inside somebody else's document, and
 * viewport coordinates would be right only while nothing above it scrolled.
 *
 * Null whenever the target cannot be found, which is a normal outcome rather
 * than a fault — the rail is not drawn below 1200px, and three of the top
 * bar's controls move to the bottom bar on a phone. See `TourStep.target`.
 */
function measureTarget(root: HTMLElement, target?: string): Box | null {
  if (!target) return null;
  // `getRootNode()` rather than `document`: everything here lives inside the
  // Studio's shadow root, and a document-level query finds none of it.
  const scope = root.getRootNode();
  if (!(scope instanceof Document || scope instanceof ShadowRoot)) return null;
  const node = scope.querySelector(`[data-val-tour="${target}"]`);
  if (!(node instanceof HTMLElement)) return null;
  const rect = node.getBoundingClientRect();
  // A control that is in the tree but not on screen — `display:none` on a
  // hidden panel, a button that has not laid out yet — measures zero, and a
  // spotlight on a zero-sized box is a dot in the corner.
  if (rect.width === 0 || rect.height === 0) return null;
  const rootRect = root.getBoundingClientRect();
  return {
    top: rect.top - rootRect.top,
    left: rect.left - rootRect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Where to put the card, given what it is pointing at and how much room there
 * is.
 *
 * Below the target when it fits, above it when it does not, and centred when
 * there is no target at all. Always clamped inside the shell: a card that
 * hangs off the edge is a card with its buttons off the edge.
 */
export function placeCard(
  target: Box | null,
  shell: { width: number; height: number },
  card: { width: number; height: number },
): { top: number; left: number } {
  if (!target) {
    return {
      top: Math.max(MARGIN, (shell.height - card.height) / 2),
      left: Math.max(MARGIN, (shell.width - card.width) / 2),
    };
  }
  const below = target.top + target.height + GAP;
  const above = target.top - card.height - GAP;
  const top =
    below + card.height + MARGIN <= shell.height
      ? below
      : above >= MARGIN
        ? above
        : Math.max(MARGIN, (shell.height - card.height) / 2);
  // Aligned to the target's left edge, so the card reads as belonging to it,
  // then pulled back inside the shell.
  const left = Math.min(
    Math.max(MARGIN, target.left),
    Math.max(MARGIN, shell.width - card.width - MARGIN),
  );
  return { top, left };
}

export type StudioTourProps = {
  steps: TourStep[];
  /**
   * Leaves the tour, however it was left.
   *
   * One callback rather than a finished/abandoned pair, because the caller
   * treats the two the same — see `closeTour` in `Shell`.
   */
  onClose: () => void;
  /**
   * Open (or close, with `null`) a panel, so the step's subject is on screen
   * behind the card. The tour drives the real navigation rather than drawing
   * a picture of it: what someone has to recognise again tomorrow is the
   * panel, not an illustration of one.
   */
  onOpenPanel: (panel: TourStep["panel"] | null) => void;
};

/**
 * The guided tour: a spotlight, a card, and Back/Next.
 *
 * Deliberately not a modal dialog from the design system. It has to sit ABOVE
 * the panels it opens (`z-overlay`, the one layer above `z-full`) while those
 * panels keep working underneath, and a dialog would both trap focus inside
 * itself and close the moment the tour opened a panel behind it.
 */
export function StudioTour({ steps, onClose, onOpenPanel }: StudioTourProps) {
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const step = steps[index];
  const isLast = index === steps.length - 1;

  // The panel this step wants, before anything is measured: the rail button it
  // spotlights does not move, but the panel opening is what the step is FOR.
  const panel = step?.panel;
  useEffect(() => {
    onOpenPanel(panel ?? null);
  }, [panel, onOpenPanel]);

  /**
   * Measure after layout, not after paint: the card is positioned from its own
   * height, so measuring in `useEffect` would show it in the wrong place for
   * one frame and then move it.
   */
  useLayoutEffect(() => {
    const measure = () => {
      const root = rootRef.current;
      const card = cardRef.current;
      if (!root || !card) return;
      const box = measureTarget(root, step?.target);
      setTarget(box);
      const rootRect = root.getBoundingClientRect();
      setPlacement(
        placeCard(
          box,
          { width: rootRect.width, height: rootRect.height },
          { width: card.offsetWidth, height: card.offsetHeight },
        ),
      );
    };
    measure();
    // A panel sliding in, a phone rotating, the browser resizing: all of them
    // move the thing being pointed at. A second pass on the next frame catches
    // the panel that had not laid out when the step changed.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [index, step?.target]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  if (!step) return null;

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-overlay"
      role="dialog"
      aria-label="Studio tour"
      aria-modal="false"
    >
      {/*
       * A transparent sheet over the whole shell, so a stray click lands on the
       * tour rather than on the editor underneath. It does NOT dismiss: the
       * dimmed half of the screen is the part someone is being asked to look
       * at, and losing your place in a tour by clicking at it is worse than
       * having to find the X. Escape and the X are the ways out.
       */}
      <div className="absolute inset-0" aria-hidden />
      {/*
       * The dimming and the spotlight are one element: a box the size of the
       * target with a shadow big enough to cover everything else. Two elements
       * — a scrim with a hole punched in it — cannot be done without either a
       * mask or four separate strips, and both drift out of alignment the
       * moment the target moves. With nothing to point at it collapses to a
       * plain scrim over everything.
       *
       * `pointer-events-none` because it is the sheet above that catches
       * clicks; a box shadow catches none of its own.
       */}
      <div
        aria-hidden
        className={cn(
          "absolute pointer-events-none transition-[top,left,width,height] duration-200",
          target
            ? "rounded-md ring-2 ring-border-brand-secondary"
            : "inset-0 rounded-none",
        )}
        style={{
          ...(target
            ? {
                top: target.top - 4,
                left: target.left - 4,
                width: target.width + 8,
                height: target.height + 8,
              }
            : {}),
          boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.55)",
        }}
      />
      <div
        ref={cardRef}
        style={{
          width: CARD_WIDTH,
          maxWidth: "calc(100% - 24px)",
          // Off screen until it has been measured, so the first frame of a
          // step is never the card in the top left corner.
          ...(placement ?? { top: -9999, left: 0 }),
        }}
        className="absolute rounded-lg border border-border-float bg-bg-float p-3.5 shadow-lg"
      >
        <div className="flex items-start gap-2">
          <Compass
            size={15}
            className="mt-0.5 shrink-0 text-fg-brand-secondary"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-[0.8125rem] font-semibold tracking-tight">
              {step.title}
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">
              {step.body}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the tour"
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
          >
            <X size={14} />
          </button>
        </div>
        <div className="mt-3.5 flex items-center gap-2">
          <span className="text-[0.6875rem] tabular-nums text-fg-secondary-alt">
            {index + 1} / {steps.length}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex((current) => current - 1)}
                className="inline-flex h-7 items-center rounded-md border border-border-float px-2.5 text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                isLast ? onClose() : setIndex((current) => current + 1)
              }
              className="inline-flex h-7 items-center rounded-md border border-border-brand-primary bg-bg-brand-primary px-2.5 text-xs font-medium text-fg-brand-primary hover:bg-bg-brand-primary-hover"
            >
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Take a tour" button, glowing.
 *
 * Glowing rather than popping up. A tour that opens itself is the single most
 * annoying thing an editor can be given on their second visit, and the
 * feedback that produced this asked for help finding things — not for a
 * dialog to dismiss. So the offer is a button that catches the eye and can be
 * completely ignored; it stops glowing for good once the tour has been taken.
 *
 * The halo is behind `motion-safe:`, so a browser that has been told to
 * reduce motion gets an ordinary button in brand colours.
 */
export function TourLauncher({
  onStart,
  className,
  /** Just the icon, for the bars where a word does not fit. */
  compact,
}: {
  onStart: () => void;
  className?: string;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="Take a tour of the Studio"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-brand-secondary text-xs font-medium text-fg-brand-secondary",
        "motion-safe:animate-tour-glow hover:bg-bg-float-raised",
        compact ? "w-8 justify-center" : "px-2.5",
        className,
      )}
    >
      <Compass size={14} className="shrink-0" />
      {!compact && <span>Take a tour</span>}
    </button>
  );
}
