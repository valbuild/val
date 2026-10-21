import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { SourcePath } from "@valbuild/core";
import { Compass, X } from "lucide-react";
import { cn } from "../designSystem/cn";
import { isPathWithin } from "../../utils/sourcePath";
import { TourMoveOn, TourStep } from "./tourSteps";
import { ShellPanel } from "./types";
import { CLEAR_OF_BOTTOM_BARS } from "./MobileChrome";

/** Where the card is drawn, in shell coordinates. */
type Box = { top: number; left: number; width: number; height: number };

/**
 * How far the card sits from the thing it points at, in px: room for the
 * arrow, whose tip then reaches the ring (4-6px outside the target).
 */
const GAP = 14;
/** Never closer than this to the edge of the shell. */
const MARGIN = 12;
const CARD_WIDTH = 296;
/**
 * Below this width the ring look's card is a sheet along the bottom rather
 * than a card beside its target: on a phone there is no beside, and a card
 * in the middle of the page covers the heading it is asking you to click.
 */
const SHEET_BELOW = 640;

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
function measureTarget(
  root: HTMLElement,
  target?: string,
  field?: SourcePath,
): Box | null {
  if (!target && !field) return null;
  // `getRootNode()` rather than `document`: everything here lives inside the
  // Studio's shadow root, and a document-level query finds none of it.
  const scope = root.getRootNode();
  if (!(scope instanceof Document || scope instanceof ShadowRoot)) return null;
  /*
   * A field, wherever it is shown: the page's fields column marks each with
   * `data-canvas-field`, the module editor with `data-val-studio-path`. The
   * path goes into the selector as a CSS string, quotes and all -- a source
   * path has them (`?p="/"."title"`) and would otherwise end the selector.
   */
  if (field) {
    const value = JSON.stringify(field);
    const box = firstOnScreen(
      scope,
      `[data-canvas-field=${value}], [data-val-studio-path=${value}]`,
    );
    if (box) return relativeTo(root, box);
  }
  if (!target) return null;
  /*
   * The first one that is on screen, not the first in the tree: a control can
   * be drawn twice, once for wide screens and once for phones, with the other
   * hidden -- the language filter is -- and the hidden one may come first.
   *
   * A control that is in the tree but not on screen — `display:none` on a
   * hidden panel, a button that has not laid out yet — measures zero, and a
   * spotlight on a zero-sized box is a dot in the corner.
   */
  const rect = firstOnScreen(scope, `[data-val-tour="${target}"]`);
  return rect ? relativeTo(root, rect) : null;
}

/** The first element matching `selector` that has a box on screen. */
function firstOnScreen(
  scope: Document | ShadowRoot,
  selector: string,
): DOMRect | null {
  for (const node of scope.querySelectorAll(selector)) {
    if (!(node instanceof HTMLElement)) continue;
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    return box;
  }
  return null;
}

function relativeTo(root: HTMLElement, rect: DOMRect): Box {
  const rootRect = root.getBoundingClientRect();
  return {
    top: rect.top - rootRect.top,
    left: rect.left - rootRect.left,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * The open panel, if there is one, in the same coordinates.
 *
 * A step that opens a panel is a step ABOUT that panel, and the card was
 * landing on top of it: the spotlight is on a 32px rail icon at the left edge,
 * "below the target" is directly over the panel that just slid out, and the
 * reader was told to look at something the tour was covering.
 *
 * Whichever panel is on screen rather than the one this step asked for — a
 * panel left open from before is just as much in the way.
 */
function measureAvoid(root: HTMLElement): Box | null {
  const scope = root.getRootNode();
  if (!(scope instanceof Document || scope instanceof ShadowRoot)) return null;
  const rootRect = root.getBoundingClientRect();
  for (const node of scope.querySelectorAll("[data-val-tour-surface]")) {
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    // A panel rendered but hidden — the assistant, which is never unmounted —
    // measures zero and is not in anybody's way.
    if (rect.width === 0 || rect.height === 0) continue;
    return {
      top: rect.top - rootRect.top,
      left: rect.left - rootRect.left,
      width: rect.width,
      height: rect.height,
    };
  }
  return null;
}

/** Whether two boxes share any pixels. */
function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
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
  /** A region the card must not cover, when it can be helped. See `measureAvoid`. */
  avoid?: Box | null,
): { top: number; left: number } {
  if (!target) {
    return {
      top: Math.max(MARGIN, (shell.height - card.height) / 2),
      left: Math.max(MARGIN, (shell.width - card.width) / 2),
    };
  }
  const below = target.top + target.height + GAP;
  const above = target.top - card.height - GAP;
  const fitsBelow = below + card.height + MARGIN <= shell.height;
  const fitsAbove = above >= MARGIN;
  if (!fitsBelow && !fitsAbove) {
    /*
     * A target as tall as the shell -- the page, on a laptop -- leaves no
     * room above or below it, and the middle of the shell is the middle of the
     * TARGET: the card landed on the very heading it was asking someone to
     * click, and took the click. Beside it, on whichever side there is room,
     * level with its top; the middle only when there is room on neither.
     */
    const beside =
      target.left + target.width + GAP + card.width + MARGIN <= shell.width
        ? target.left + target.width + GAP
        : target.left - GAP - card.width >= MARGIN
          ? target.left - GAP - card.width
          : null;
    if (beside !== null) {
      return {
        top: Math.min(
          Math.max(MARGIN, target.top),
          Math.max(MARGIN, shell.height - card.height - MARGIN),
        ),
        left: beside,
      };
    }
  }
  const top = fitsBelow
    ? below
    : fitsAbove
      ? above
      : Math.max(MARGIN, (shell.height - card.height) / 2);
  // Aligned to the target's left edge, so the card reads as belonging to it,
  // then pulled back inside the shell.
  const clamp = (value: number) =>
    Math.min(
      Math.max(MARGIN, value),
      Math.max(MARGIN, shell.width - card.width - MARGIN),
    );
  const left = clamp(target.left);
  if (!avoid || !overlaps({ top, left, ...card }, avoid)) {
    return { top, left };
  }
  // Beside the panel rather than over it, on whichever side it fits. If it
  // fits on neither — a phone, where a sheet is most of the screen — the
  // original placement stands: a card half off the screen is worse than a
  // card over a panel.
  const beyond = avoid.left + avoid.width + GAP;
  const before = avoid.left - GAP - card.width;
  if (beyond + card.width + MARGIN <= shell.width) {
    return { top, left: beyond };
  }
  if (before >= MARGIN) {
    return { top, left: before };
  }
  return { top, left };
}

/**
 * The card's arrow: which of its edges faces the target, and how far along
 * that edge the arrow sits, in px from the edge's start (its left, or its top).
 */
export type CardArrow = {
  side: "top" | "bottom" | "left" | "right";
  offset: number;
};

/** The arrow keeps this far from the card's corners, which are rounded. */
const ARROW_INSET = 16;

/**
 * Where the card's arrow goes, from where the card ended up rather than from
 * which rule put it there: `placeCard` clamps, and steps aside for panels.
 *
 * The edge facing the target, aimed at the middle of what the two share along
 * that edge. Null when they share nothing -- a card moved beside a panel, or
 * centred because there is no target -- since an arrow pointing past the
 * thing it is about is worse than none.
 */
export function pointArrow(target: Box | null, card: Box): CardArrow | null {
  if (!target) return null;
  const along = (
    cardStart: number,
    cardSize: number,
    targetStart: number,
    targetSize: number,
  ): number | null => {
    const from = Math.max(cardStart, targetStart);
    const to = Math.min(cardStart + cardSize, targetStart + targetSize);
    if (to <= from || cardSize < ARROW_INSET * 2) return null;
    const middle = (from + to) / 2 - cardStart;
    return Math.min(Math.max(middle, ARROW_INSET), cardSize - ARROW_INSET);
  };
  const side: CardArrow["side"] | null =
    card.top >= target.top + target.height
      ? "top"
      : card.top + card.height <= target.top
        ? "bottom"
        : card.left >= target.left + target.width
          ? "left"
          : card.left + card.width <= target.left
            ? "right"
            : null;
  if (side === null) return null;
  const offset =
    side === "top" || side === "bottom"
      ? along(card.left, card.width, target.left, target.width)
      : along(card.top, card.height, target.top, target.height);
  return offset === null ? null : { side, offset };
}

/**
 * The arrow itself: a small square turned 45 degrees, half over the card's
 * edge, with the card's fill and its border on the two sides that show, so
 * it reads as part of the card rather than something stuck to it.
 */
const ARROW_EDGE: Record<CardArrow["side"], string> = {
  top: "-top-[6px] border-l border-t",
  bottom: "-bottom-[6px] border-b border-r",
  left: "-left-[6px] border-b border-l",
  right: "-right-[6px] border-r border-t",
};

/**
 * What the Studio is doing, as far as a step that moves on by itself cares.
 * See `TourMoveOn`.
 */
export type TourObserved = {
  /** The field that is open, if any: the canvas's selection. */
  selectedPath: SourcePath | null;
  /** How many changes Review counts. */
  reviewCount: number;
  openPanel: ShellPanel | null;
  /** The language shown, where the project has more than one. */
  locale: string | null;
};

/**
 * How a step's "Do it for me" is done: the same calls the Studio makes when
 * the visitor does it themselves, so what it does is what they would have.
 * One that is absent is not offered.
 */
export type TourActions = {
  openPath?: (path: SourcePath) => void;
  write?: (path: SourcePath, value: string) => void;
  nextLocale?: () => void;
};

/**
 * Whether the visitor has done what this step asks, judged against how things
 * were when the step began. An edit or a language change has to happen DURING
 * the step: one made before it is not the visitor answering it.
 */
export function hasMovedOn(
  moveOn: TourMoveOn,
  now: TourObserved,
  atStart: TourObserved,
): boolean {
  switch (moveOn.type) {
    case "open":
      return (
        now.selectedPath !== null && isPathWithin(now.selectedPath, moveOn.path)
      );
    case "edit":
      return now.reviewCount > atStart.reviewCount;
    case "panel":
      return now.openPanel === moveOn.panel;
    case "locale":
      return now.locale !== atStart.locale;
  }
}

/** Whether this step's "Do it for me" can be done here. */
export function canDoItForMe(
  moveOn: TourMoveOn,
  act: TourActions,
  canOpenPanel: boolean,
): boolean {
  switch (moveOn.type) {
    case "open":
      return act.openPath !== undefined;
    case "edit":
      return moveOn.write !== undefined && act.write !== undefined;
    case "panel":
      return canOpenPanel;
    case "locale":
      return act.nextLocale !== undefined;
  }
}

/**
 * How long a step that has been done stays up before the next one: long
 * enough to see that it worked, short enough not to wait for.
 */
const MOVE_ON_DELAY_MS = 700;

const NOT_OBSERVED: TourObserved = {
  selectedPath: null,
  reviewCount: 0,
  openPanel: null,
  locale: null,
};

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
  /**
   * How it looks.
   *
   * `spotlight`, the Studio's own tour: everything but the target dimmed, and
   * the card holding focus.
   *
   * `ring`, the demo's: nothing dimmed, a ring around the target, and the
   * Studio usable underneath -- because the demo's steps ask the visitor to
   * DO things there, and a step that moves on when you click the page cannot
   * sit behind a sheet that catches the click. Focus stays where the visitor
   * is working; each step is announced instead.
   */
  look?: "spotlight" | "ring";
  /** What the Studio is doing, for steps with `moveOn`. */
  observed?: TourObserved;
  /** How "Do it for me" is done. */
  act?: TourActions;
  /** Outline a place on the page (a step's `page`), or nothing. */
  onHighlightPage?: (path: SourcePath | null) => void;
};

/**
 * The guided tour: a spotlight, a card, and Back/Next.
 *
 * Deliberately not a modal dialog from the design system. It has to sit ABOVE
 * the panels it opens (`z-overlay`, the one layer above `z-full`) while those
 * panels keep working underneath, and a dialog would both trap focus inside
 * itself and close the moment the tour opened a panel behind it.
 */
export function StudioTour({
  steps,
  onClose,
  onOpenPanel,
  look = "spotlight",
  observed = NOT_OBSERVED,
  act = {},
  onHighlightPage,
}: StudioTourProps) {
  const ring = look === "ring";
  const [index, setIndex] = useState(0);
  // Unique per mount: the Studio is one shadow root, and a duplicate id would
  // point another dialog's label at this card's heading.
  const titleId = useId();
  const bodyId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /**
   * Never past the end, however the list got shorter.
   *
   * The steps are built from the project's destinations, and those arrive after
   * mount: while the navigation loads, `availableDestinations` offers all three
   * so the rail does not grow icons as data lands. A tour started in that
   * window can be on step 5 of 9 when the real project turns out to have 6 —
   * and an index past the end rendered NOTHING while the shell still believed
   * the tour was open, so there was no card, no X and no way out.
   *
   * Clamped rather than closed: losing your place is better than being thrown
   * out of something you are halfway through, and the last step is a real step.
   */
  const stepIndex = Math.min(index, Math.max(0, steps.length - 1));
  const [target, setTarget] = useState<Box | null>(null);
  const [placement, setPlacement] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [asSheet, setAsSheet] = useState(false);
  const [arrow, setArrow] = useState<CardArrow | null>(null);
  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;

  // The panel this step wants, before anything is measured: the rail button it
  // spotlights does not move, but the panel opening is what the step is FOR.
  const panel = step?.panel;
  useEffect(() => {
    onOpenPanel(panel ?? null);
  }, [panel, onOpenPanel]);

  // The place on the page this step is about, outlined by the page itself;
  // cleared when the tour closes, so the outline does not outlive the card.
  const page = step?.page ?? null;
  useEffect(() => {
    onHighlightPage?.(page);
  }, [page, onHighlightPage]);
  useEffect(() => () => onHighlightPage?.(null), [onHighlightPage]);

  /*
   * How things were when this step began, which an edit or a language change
   * is measured against. Taken during render, on the render that shows the
   * step, so it is in place before the effect below first looks: taken in an
   * effect, the effect judging the step could run first and compare against
   * the previous step's start.
   */
  const startedAt = useRef<{ index: number; observed: TourObserved } | null>(
    null,
  );
  if (startedAt.current?.index !== stepIndex) {
    startedAt.current = { index: stepIndex, observed };
  }
  const moveOn = step?.moveOn;
  const done =
    moveOn !== undefined &&
    hasMovedOn(moveOn, observed, startedAt.current.observed);
  const advance = () => (isLast ? onClose() : setIndex(stepIndex + 1));
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(
      () => advanceRef.current(),
      MOVE_ON_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [done, stepIndex]);
  const doItForMe = () => {
    if (!moveOn) return;
    switch (moveOn.type) {
      case "open":
        act.openPath?.(moveOn.path);
        return;
      case "edit":
        if (moveOn.write) act.write?.(moveOn.write.path, moveOn.write.value);
        return;
      case "panel":
        onOpenPanel(moveOn.panel);
        return;
      case "locale":
        act.nextLocale?.();
        return;
    }
  };
  const offerDoItForMe =
    moveOn !== undefined && canDoItForMe(moveOn, act, true);

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
      const box = measureTarget(root, step?.target, step?.field);
      setTarget(box);
      const rootRect = root.getBoundingClientRect();
      const sheet = ring && rootRect.width < SHEET_BELOW;
      setAsSheet(sheet);
      const size = { width: card.offsetWidth, height: card.offsetHeight };
      const at = placeCard(
        box,
        { width: rootRect.width, height: rootRect.height },
        size,
        measureAvoid(root),
      );
      setPlacement(at);
      // A sheet along the bottom is not beside anything, so it points at
      // nothing; the ring above it does that.
      setArrow(sheet ? null : pointArrow(box, { ...at, ...size }));
    };
    measure();
    /*
     * A panel sliding in, a phone rotating, the browser resizing: all of them
     * move what is being pointed at, or what has to be kept clear.
     *
     * Two more passes, because the panel a step opens is mounted by an effect
     * of its own: on the frame the step changes there is nothing to measure
     * yet, and one frame later it may be laid out but not settled.
     */
    const frames = [
      requestAnimationFrame(measure),
      window.setTimeout(measure, 120),
    ];
    window.addEventListener("resize", measure);
    /*
     * And any scroll inside the Studio: a ring around a field in a column that
     * scrolls is left behind otherwise. On the Studio's root, capturing --
     * scroll does not bubble, and it does not leave a shadow root, so a
     * listener on `window` never hears one from in here.
     */
    const scope = rootRef.current?.getRootNode();
    const scrolls =
      scope instanceof Document || scope instanceof ShadowRoot ? scope : null;
    scrolls?.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frames[0]);
      window.clearTimeout(frames[1]);
      window.removeEventListener("resize", measure);
      scrolls?.removeEventListener("scroll", measure, true);
    };
  }, [stepIndex, step?.target, step?.field, ring]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  /**
   * Focus moves into the card, and back out again when the tour closes.
   *
   * Without it the keyboard was left on whatever started the tour — a button
   * now underneath the overlay, and one that is sometimes unmounted by the step
   * that follows — so Next and the X were reachable only by tabbing blindly
   * through a shell the reader cannot see.
   *
   * On every step, not only on open: the card's heading is the step, so moving
   * focus is also what announces it. The card itself takes focus rather than a
   * button in it, so a screen reader reads the step before its controls.
   *
   * Not a focus TRAP. `aria-modal="false"` is the honest description of this
   * overlay — the panel behind it is the thing being explained, and it stays in
   * the accessibility tree — so tabbing out of the card is allowed to work.
   */
  useEffect(() => {
    // Captured BEFORE the effect below moves focus into the card — effects run
    // in declaration order, and declared the other way round this recorded the
    // card it had just been handed and "restored" focus to a removed element.
    //
    // The shadow root's active element, not the document's: the document sees
    // the Studio's host element and nothing inside it.
    // The ring takes no focus, so it has none to give back.
    if (ring) return;
    const scope = rootRef.current?.getRootNode();
    const previous =
      scope instanceof Document || scope instanceof ShadowRoot
        ? scope.activeElement
        : null;
    const root = rootRef.current;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
        return;
      }
      /*
       * What started the tour is sometimes gone by the time it ends: from Quick
       * actions, the welcome step closes that panel and unmounts the very
       * button that was pressed. Landing the keyboard on `<body>` after that
       * means tabbing back in from the top of the host page.
       *
       * Quick actions is the tour's permanent home and the control the last
       * step points at, so its button is where focus goes instead. Absent on a
       * phone, where the top bar does not carry it; there is nothing better to
       * offer there, and no harm in leaving it.
       */
      const scope = root?.getRootNode();
      const fallback =
        scope instanceof Document || scope instanceof ShadowRoot
          ? scope.querySelector('[data-val-tour="utility"]')
          : null;
      if (fallback instanceof HTMLElement) {
        fallback.focus();
      }
    };
  }, [ring]);
  useEffect(() => {
    if (ring) return;
    cardRef.current?.focus();
  }, [stepIndex, ring]);

  if (!step) return null;

  return (
    <div
      ref={rootRef}
      // In the ring look the overlay lets every click through but the card's:
      // the visitor is being asked to do things in the Studio behind it.
      className={cn(
        "absolute inset-0 z-overlay",
        ring && "pointer-events-none",
      )}
    >
      {!ring && (
        /*
         * A transparent sheet over the whole shell, so a stray click lands on
         * the tour rather than on the editor underneath. It does NOT dismiss:
         * the dimmed half of the screen is the part someone is being asked to
         * look at, and losing your place in a tour by clicking at it is worse
         * than having to find the X. Escape and the X are the ways out.
         */
        <div className="absolute inset-0" aria-hidden />
      )}
      {ring ? (
        target && (
          /*
           * The ring: a 2px line just outside the target, following its
           * corners, with a soft halo -- and nothing dimmed. Its own layer
           * rather than an `outline` on the element, so a parent's
           * `overflow: hidden` cannot clip it. It glides from one target to the
           * next, and pulses once when it lands (keyed on the step, so the
           * pulse runs again for each); with reduced motion it jumps there and
           * does not pulse.
           */
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-md transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none"
            style={{
              top: target.top - 4,
              left: target.left - 4,
              width: target.width + 8,
              height: target.height + 8,
              outline: "2px solid var(--border-brand-secondary)",
              boxShadow:
                "0 0 0 6px color-mix(in srgb, var(--border-brand-secondary) 22%, transparent)",
            }}
          >
            <div
              key={step.id}
              className="absolute inset-0 rounded-md motion-safe:animate-tour-arrive"
            />
          </div>
        )
      ) : (
        /*
         * The dimming and the spotlight are one element: a box the size of the
         * target with a shadow big enough to cover everything else. Two
         * elements — a scrim with a hole punched in it — cannot be done
         * without either a mask or four separate strips, and both drift out of
         * alignment the moment the target moves. With nothing to point at it
         * collapses to a plain scrim over everything.
         *
         * `pointer-events-none` because it is the sheet above that catches
         * clicks; a box shadow catches none of its own.
         */
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
      )}
      {ring && (
        /*
         * What a screen reader hears of each step, since the ring does not move
         * focus to say it. Polite: the visitor is in the middle of something.
         */
        <p className="sr-only" aria-live="polite">
          {step.title}. {step.body}
        </p>
      )}
      {/*
       * The dialog is the CARD, not the sheet around it.
       *
       * It is what focus is moved to on every step, and naming it after the
       * STEP is the difference between a screen reader announcing "Studio tour"
       * nine times and announcing what this stop is about. `aria-modal` is
       * false because it is not one: the panel behind is the thing being
       * explained, and it stays in the accessibility tree.
       */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        // A stable hook for the screenshot script, which used to find this by
        // its accessible name — now the step's title, and so not a constant.
        data-val-tour-card=""
        data-val-tour-step={step.id}
        // Focusable only programmatically: it is a container, and a tab stop of
        // its own would put an extra empty stop before the buttons.
        tabIndex={-1}
        style={
          asSheet
            ? undefined
            : {
                width: CARD_WIDTH,
                maxWidth: "calc(100% - 24px)",
                // Off screen until it has been measured, so the first frame of
                // a step is never the card in the top left corner.
                ...(placement ?? { top: -9999, left: 0 }),
              }
        }
        className={cn(
          "absolute rounded-lg border border-border-float bg-bg-float p-3.5 shadow-lg focus-visible:outline-none",
          ring &&
            "pointer-events-auto transition-[top,left] duration-300 ease-out motion-reduce:transition-none",
          // Along the bottom, above the bars there, the full width less a
          // margin: the ring stays visible above it.
          asSheet && ["left-3 right-3", CLEAR_OF_BOTTOM_BARS],
        )}
      >
        {arrow && (
          <div
            aria-hidden
            data-val-tour-arrow={arrow.side}
            className={cn(
              "pointer-events-none absolute h-[10px] w-[10px] rotate-45 border-border-float bg-bg-float",
              ARROW_EDGE[arrow.side],
            )}
            style={
              arrow.side === "top" || arrow.side === "bottom"
                ? { left: arrow.offset - 5 }
                : { top: arrow.offset - 5 }
            }
          />
        )}
        <div className="flex items-start gap-2">
          {/*
           * The same green as the spotlight ring, which is the tour's colour.
           * NOT `text-fg-brand-secondary`: that token is the foreground FOR a
           * filled `bg-bg-brand-secondary` surface — in dark mode it is
           * near-black — and on an unfilled card it disappeared.
           */}
          <Compass
            size={15}
            className="mt-0.5 shrink-0 text-border-brand-secondary"
          />
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="text-[0.8125rem] font-semibold tracking-tight"
            >
              {step.title}
            </h2>
            <p
              id={bodyId}
              className="mt-1.5 text-xs leading-relaxed text-fg-secondary"
            >
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
            {stepIndex + 1} / {steps.length}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {moveOn ? (
              /*
               * A step that moves on when it has been done has no Next: doing
               * it is the way on. Skip is there for anyone who would rather
               * not, and Do it for me for anyone who would rather watch --
               * offered only where it can be done, because a button that does
               * nothing is worse than none.
               */
              <>
                <button
                  type="button"
                  onClick={advance}
                  className="inline-flex h-7 items-center rounded-md px-2 text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
                >
                  Skip
                </button>
                {offerDoItForMe && (
                  <button
                    type="button"
                    onClick={doItForMe}
                    disabled={done}
                    className="inline-flex h-7 items-center rounded-md border border-border-brand-primary bg-bg-brand-primary px-2.5 text-xs font-medium text-fg-brand-primary hover:bg-bg-brand-primary-hover disabled:opacity-60"
                  >
                    Do it for me
                  </button>
                )}
              </>
            ) : (
              <>
                {stepIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => setIndex(stepIndex - 1)}
                    className="inline-flex h-7 items-center rounded-md border border-border-float px-2.5 text-xs text-fg-secondary hover:bg-bg-float-raised hover:text-fg-primary"
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={advance}
                  className="inline-flex h-7 items-center rounded-md border border-border-brand-primary bg-bg-brand-primary px-2.5 text-xs font-medium text-fg-brand-primary hover:bg-bg-brand-primary-hover"
                >
                  {isLast ? "Done" : "Next"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The "Take a tour" button.
 *
 * It lives in exactly two places: the empty editor — the first thing anybody
 * sees, at `/val/~` — and Quick actions. Deliberately NOT in the top bar: that
 * row is the controls for shipping a change, and a permanent onboarding button
 * among Review, Preview and Publish is clutter for everyone who has already
 * read it once.
 *
 * Glowing rather than popping up. A tour that opens itself is the single most
 * annoying thing an editor can be given on their second visit, and the feedback
 * that produced this asked for help finding things — not for a dialog to
 * dismiss. So the offer is a button that catches the eye and can be completely
 * ignored, and it stops glowing for good once the tour has been taken.
 *
 * The halo is behind `motion-safe:`, so a browser that has been told to reduce
 * motion gets a still button in brand colours.
 */
export function TourLauncher({
  onStart,
  className,
  /** Just the icon, for the bars where a word does not fit. */
  compact,
  /** Whether this is still an offer. Quiet, but present, once it is not. */
  glow = true,
}: {
  onStart: () => void;
  className?: string;
  compact?: boolean;
  glow?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onStart}
      aria-label="Take a tour of the Studio"
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border text-xs font-medium hover:bg-bg-float-raised",
        // The label is `fg-primary`, not `fg-brand-secondary`: that token is the
        // foreground for a FILLED brand surface and is near-black in dark mode,
        // so on an outlined button it was unreadable. The green is the border
        // and the glow, which is where it does the work.
        glow
          ? "border-border-brand-secondary text-fg-primary motion-safe:animate-tour-glow"
          : "border-border-float text-fg-secondary hover:text-fg-primary",
        compact ? "w-8 justify-center" : "px-2.5",
        className,
      )}
    >
      <Compass size={14} className="shrink-0" />
      {!compact && <span>Take a tour</span>}
    </button>
  );
}
