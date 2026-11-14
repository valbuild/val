import type { CSSProperties } from "react";

/**
 * Where the overlay menu sits on the user's page.
 *
 * Not a fixed set of slots: the menu is dragged, and wherever it is let go it
 * snaps to the NEAREST EDGE of the viewport, keeping its position along that
 * edge. So a placement is an edge and how far along it the menu's circle is.
 * The eight named docks the menu used to have are presets of this
 * (`placementOfDock`), offered in the menu's settings for anyone who would
 * rather pick than drag.
 *
 * Pure: no DOM, no React, so the snapping can be tested on numbers.
 */

export type OverlayEdge = "left" | "right" | "top" | "bottom";

export type OverlayPlacement = {
  edge: OverlayEdge;
  /**
   * Where the circle's centre is along the edge, from 0 (the top, or the
   * left) to 1. Exactly 0.5 is special: the menu then expands both ways from
   * the middle, the way a centred bar does.
   */
  offset: number;
};

export type OverlayMenuOrientation = "horizontal" | "vertical";

/** The eight named positions, kept as presets. */
export type OverlayDock =
  | "left-top"
  | "left-center"
  | "left-bottom"
  | "center-top"
  | "center-bottom"
  | "right-top"
  | "right-center"
  | "right-bottom";

export const OVERLAY_DOCKS: readonly OverlayDock[] = [
  "left-top",
  "center-top",
  "right-top",
  "left-center",
  "right-center",
  "left-bottom",
  "center-bottom",
  "right-bottom",
];

export const DEFAULT_OVERLAY_PLACEMENT: OverlayPlacement = {
  edge: "right",
  offset: 0.5,
};

/** Distance from the viewport's edge to the menu, in px. */
export const OVERLAY_MARGIN = 12;
/** The collapsed menu: a 32px circle in a 4px ring of bar, and its 1px border. */
export const OVERLAY_LAUNCHER_SIZE = 42;
/**
 * How close to the middle of an edge a drop has to be to snap to it, as a
 * fraction of the edge. The middle is the one point along an edge that is
 * worth hitting exactly, because it is the only one that looks deliberate.
 */
const CENTRE_SNAP = 0.06;

export function placementOrientation(
  placement: OverlayPlacement,
): OverlayMenuOrientation {
  return placement.edge === "left" || placement.edge === "right"
    ? "vertical"
    : "horizontal";
}

/**
 * Which way the menu grows when it expands, so it opens into the page rather
 * than off the end of it: away from the nearer end of its edge, or both ways
 * from the middle.
 */
export type OverlayGrowth = "forward" | "backward" | "centre";

export function placementGrowth(placement: OverlayPlacement): OverlayGrowth {
  if (placement.offset === 0.5) return "centre";
  return placement.offset < 0.5 ? "forward" : "backward";
}

export function placementOfDock(dock: OverlayDock): OverlayPlacement {
  switch (dock) {
    case "left-top":
      return { edge: "top", offset: 0 };
    case "center-top":
      return { edge: "top", offset: 0.5 };
    case "right-top":
      return { edge: "top", offset: 1 };
    case "left-center":
      return { edge: "left", offset: 0.5 };
    case "right-center":
      return { edge: "right", offset: 0.5 };
    case "left-bottom":
      return { edge: "bottom", offset: 0 };
    case "center-bottom":
      return { edge: "bottom", offset: 0.5 };
    case "right-bottom":
      return { edge: "bottom", offset: 1 };
  }
}

/**
 * The named position a placement is nearest to. For what still thinks in
 * eight slots: the cards that sit beside the menu, the side a popover opens
 * on, and the loading pill the framework packages draw before the Studio has
 * loaded (they read it from `localStorage`, see `LEGACY_STORAGE_KEY`).
 */
export function nearestDock(placement: OverlayPlacement): OverlayDock {
  const third = placement.offset < 1 / 3 ? 0 : placement.offset > 2 / 3 ? 2 : 1;
  switch (placement.edge) {
    case "left":
      return third === 0
        ? "left-top"
        : third === 2
          ? "left-bottom"
          : "left-center";
    case "right":
      return third === 0
        ? "right-top"
        : third === 2
          ? "right-bottom"
          : "right-center";
    case "top":
      return third === 0
        ? "left-top"
        : third === 2
          ? "right-top"
          : "center-top";
    case "bottom":
      return third === 0
        ? "left-bottom"
        : third === 2
          ? "right-bottom"
          : "center-bottom";
  }
}

/** Whether a placement is exactly one of the presets. */
export function isDockPlacement(
  placement: OverlayPlacement,
  dock: OverlayDock,
): boolean {
  const preset = placementOfDock(dock);
  return (
    preset.edge === placement.edge &&
    Math.abs(preset.offset - placement.offset) < 0.001
  );
}

/**
 * Where a menu let go of with its centre at `centre` comes to rest: on the
 * nearest edge, as far along it as it was.
 */
export function snapPlacement(
  centre: { x: number; y: number },
  viewport: { width: number; height: number },
): OverlayPlacement {
  const distances: Array<[OverlayEdge, number]> = [
    ["left", centre.x],
    ["right", viewport.width - centre.x],
    ["top", centre.y],
    ["bottom", viewport.height - centre.y],
  ];
  let [edge, nearest] = distances[0];
  for (const [candidate, distance] of distances) {
    if (distance < nearest) {
      edge = candidate;
      nearest = distance;
    }
  }
  const along =
    edge === "left" || edge === "right"
      ? centre.y / Math.max(1, viewport.height)
      : centre.x / Math.max(1, viewport.width);
  const clamped = Math.min(1, Math.max(0, along));
  const offset = Math.abs(clamped - 0.5) < CENTRE_SNAP ? 0.5 : clamped;
  return { edge, offset };
}

/**
 * The part of the page the person can see, in the coordinates `position:
 * fixed` uses (the layout viewport's).
 *
 * Usually the two are the same rectangle. They are not on a phone whose page
 * is wider than the screen, or that has been pinch-zoomed: `fixed` is then
 * relative to a layout viewport larger than the screen, and a menu placed
 * against its edges is partly or wholly out of sight. So the menu is placed
 * against the visible rectangle, offset into the layout one.
 */
export type OverlayViewport = {
  /** The visible rectangle. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The layout viewport `fixed` is relative to. */
  layoutWidth: number;
  layoutHeight: number;
};

/** A viewport that is all visible, for when there is no `visualViewport`. */
export function fullViewport(width: number, height: number): OverlayViewport {
  return {
    left: 0,
    top: 0,
    width,
    height,
    layoutWidth: width,
    layoutHeight: height,
  };
}

/**
 * The fixed-position style that puts the menu at `placement`.
 *
 * Anchored on the side it grows from (`top` when it grows down, `bottom` when
 * it grows up), so expanding it moves nothing but its far end and nothing has
 * to be measured. The circle is kept clear of the corners whatever the
 * offset says, so a menu dropped into a corner is still entirely on screen.
 */
export function placementStyle(
  placement: OverlayPlacement,
  viewport: OverlayViewport,
): CSSProperties {
  const half = OVERLAY_LAUNCHER_SIZE / 2;
  const vertical = placementOrientation(placement) === "vertical";
  const length = vertical ? viewport.height : viewport.width;
  const min = OVERLAY_MARGIN + half;
  const max = Math.max(min, length - OVERLAY_MARGIN - half);
  const centre = Math.min(max, Math.max(min, placement.offset * length));
  const growth = placementGrowth(placement);
  // How far each side of the visible rectangle is in from the layout
  // viewport's: what `left`, `right`, `top` and `bottom` are measured from.
  const inset = {
    left: viewport.left,
    top: viewport.top,
    right: viewport.layoutWidth - (viewport.left + viewport.width),
    bottom: viewport.layoutHeight - (viewport.top + viewport.height),
  };
  const style: CSSProperties = { position: "fixed" };
  // The edge it hugs.
  style[placement.edge] = inset[placement.edge] + OVERLAY_MARGIN;
  // Where it sits along that edge.
  const [start, end] = vertical
    ? (["top", "bottom"] as const)
    : (["left", "right"] as const);
  if (growth === "centre") {
    style[start] = inset[start] + length / 2;
    style.transform = vertical ? "translateY(-50%)" : "translateX(-50%)";
  } else if (growth === "forward") {
    style[start] = inset[start] + centre - half;
  } else {
    style[end] = inset[end] + length - centre - half;
  }
  return style;
}

/**
 * `localStorage` key the framework packages read for their loading pill.
 * They know only the eight docks, as `val-menu-<dock>`, so the nearest one is
 * written there beside the placement itself.
 */
export const LEGACY_STORAGE_KEY = "val-menu-drop-zone-default";
export const PLACEMENT_STORAGE_KEY = "val-menu-placement";

export function legacyDropZoneOf(placement: OverlayPlacement): string {
  return "val-menu-" + nearestDock(placement);
}

/**
 * Reads a stored placement: the current JSON form, or a dock name the menu
 * stored before it could be dragged freely (`val-menu-right-center`), so
 * nobody's menu moves on upgrade.
 */
export function parseStoredPlacement(
  stored: string | null,
): OverlayPlacement | null {
  if (!stored) return null;
  const dock = stored.startsWith("val-menu-")
    ? stored.slice("val-menu-".length)
    : null;
  if (dock !== null) {
    for (const candidate of OVERLAY_DOCKS) {
      if (candidate === dock) return placementOfDock(candidate);
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "edge" in parsed &&
      "offset" in parsed &&
      (parsed.edge === "left" ||
        parsed.edge === "right" ||
        parsed.edge === "top" ||
        parsed.edge === "bottom") &&
      typeof parsed.offset === "number" &&
      Number.isFinite(parsed.offset)
    ) {
      return {
        edge: parsed.edge,
        offset: Math.min(1, Math.max(0, parsed.offset)),
      };
    }
  } catch {
    return null;
  }
  return null;
}
