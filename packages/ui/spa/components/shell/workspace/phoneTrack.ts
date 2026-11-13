import type { CSSProperties } from "react";
import type { WorkspacePane } from "./workspaceLayout";

/**
 * The phone's panes, in the order the pane bar lists them and the order
 * they sit in side by side: moving from one to another slides the strip,
 * left to go right in this list and right to go left, as Content and the
 * Preview always have (`PageWorkspace`'s track).
 *
 * The Assistant before the Sketch: the conversation is what most of a
 * phone's work goes through, and the Sketch is where some of it ends up.
 */
export const PHONE_ORDER: readonly WorkspacePane[] = [
  "content",
  "preview",
  "chat",
  "sketch",
];

/** One place on the phone's strip: Content and the Preview share one. */
type StripPlace = "page" | "chat" | "sketch";

function placeOf(pane: WorkspacePane): StripPlace {
  return pane === "content" || pane === "preview" ? "page" : pane;
}

/**
 * The places on the strip there are, in order. Content and the Preview are
 * one: they move inside `PageWorkspace`'s own track, so between either of
 * them and the Assistant is one step, and a pane that is not there leaves
 * no empty place to slide through.
 */
export function phoneStrip(has: {
  chat: boolean;
  sketch: boolean;
}): StripPlace[] {
  const strip: StripPlace[] = ["page"];
  if (has.chat) strip.push("chat");
  if (has.sketch) strip.push("sketch");
  return strip;
}

/**
 * How many places `pane` is from the one in front: 0 is on screen, -1 one
 * screen to the left, 1 one screen to the right.
 */
export function phoneOffset(
  strip: readonly StripPlace[],
  pane: WorkspacePane,
  shown: WorkspacePane,
): number {
  return strip.indexOf(placeOf(pane)) - strip.indexOf(placeOf(shown));
}

/**
 * What a phone's floating pane -- `inset-x-3`, 12px in from each edge --
 * adds to its own width to move exactly one screen over.
 */
export const PHONE_PANE_GAP = 24;

/** How long a pane takes to slide, and how: `PageWorkspace`'s track too. */
export const SLIDE_MS = 320;
export const SLIDE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/**
 * Where a pane `offset` places away sits. `gap` is what a pane inset from
 * the screen's edges needs added to its own width to land exactly one
 * screen over: a pane that fills the screen needs none.
 */
export function phoneSlideStyle(
  offset: number,
  options: { gap: number; animate: boolean },
): CSSProperties {
  return {
    transform:
      offset === 0
        ? "translateX(0)"
        : `translateX(calc(${offset} * (100% + ${options.gap}px)))`,
    transition: options.animate
      ? `transform ${SLIDE_MS}ms ${SLIDE_EASE}`
      : undefined,
  };
}

/*
 * Where a phone's panes start and end: below the top bar and above the pane
 * bar, or -- in full screen, with no top bar and a smaller pane bar -- from
 * the top of the screen down to just above that. Custom properties the
 * Shell sets (`phoneInsets`), so everything that sits between the bars reads
 * one answer and follows it into full screen: the Content card, the preview,
 * the Assistant, the Sketch and Content's strip of switches.
 *
 * Each with what it is outside full screen as its fallback, so a pane drawn
 * on its own, in a story, still clears bars that are not there.
 */
const SAFE_BOTTOM = "max(0.75rem, env(safe-area-inset-bottom))";
const TOP_BELOW_BAR = "4.5rem";
const BOTTOM_ABOVE_BAR = `calc(${SAFE_BOTTOM} + 4.25rem)`;
/** Where a phone's pane starts. */
export const PHONE_TOP = `var(--val-phone-top, ${TOP_BELOW_BAR})`;
/** How far above the screen's bottom edge a phone's pane ends. */
export const PHONE_BOTTOM = `var(--val-phone-bottom, ${BOTTOM_ABOVE_BAR})`;

/** The custom properties behind {@link PHONE_TOP} and {@link PHONE_BOTTOM}. */
export function phoneInsets(fullScreen: boolean): Record<string, string> {
  return fullScreen
    ? {
        "--val-phone-top": "max(0.75rem, env(safe-area-inset-top))",
        // The compact pane bar: 50px tall, and a gap above it.
        "--val-phone-bottom": `calc(${SAFE_BOTTOM} + 3.75rem)`,
      }
    : {
        "--val-phone-top": TOP_BELOW_BAR,
        "--val-phone-bottom": BOTTOM_ABOVE_BAR,
      };
}
