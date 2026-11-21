import {
  DEFAULT_OVERLAY_PLACEMENT,
  fullViewport,
  OVERLAY_DOCKS,
  OVERLAY_LAUNCHER_SIZE,
  OVERLAY_MARGIN,
  legacyDropZoneOf,
  nearestDock,
  parseStoredPlacement,
  placementGrowth,
  placementOfDock,
  placementOrientation,
  placementStyle,
  snapPlacement,
} from "./overlayPlacement";

const phone = fullViewport(390, 844);
const desktop = fullViewport(1440, 900);

describe("snapPlacement: a menu let go of lands on the nearest edge", () => {
  test("near the right edge, as far down as it was", () => {
    expect(snapPlacement({ x: 1400, y: 225 }, desktop)).toEqual({
      edge: "right",
      offset: 0.25,
    });
  });

  test("near the bottom of a phone, as far across as it was", () => {
    const placed = snapPlacement({ x: 97.5, y: 820 }, phone);
    expect(placed.edge).toBe("bottom");
    expect(placed.offset).toBeCloseTo(0.25);
  });

  test("near the middle of an edge, exactly in the middle", () => {
    expect(snapPlacement({ x: 20, y: 470 }, desktop)).toEqual({
      edge: "left",
      offset: 0.5,
    });
  });

  test("into a corner, on whichever edge is nearer, at its end", () => {
    const placed = snapPlacement({ x: 1430, y: 5 }, desktop);
    expect(placed.edge).toBe("top");
    expect(placed.offset).toBeCloseTo(1, 1);
  });
});

describe("placementStyle: the menu stays on screen", () => {
  test("hugs its edge at the margin", () => {
    const style = placementStyle({ edge: "right", offset: 0.25 }, desktop);
    expect(style.right).toBe(OVERLAY_MARGIN);
    expect(style.top).toBe(225 - OVERLAY_LAUNCHER_SIZE / 2);
  });

  test("in a corner, keeps the circle clear of it", () => {
    const style = placementStyle({ edge: "bottom", offset: 1 }, phone);
    // Grows backward, so it is anchored by its right side.
    expect(style.right).toBe(OVERLAY_MARGIN);
    expect(style.bottom).toBe(OVERLAY_MARGIN);
  });

  test("in the middle of an edge, centred", () => {
    const style = placementStyle({ edge: "bottom", offset: 0.5 }, phone);
    expect(style.left).toBe(195);
    expect(style.transform).toBe("translateX(-50%)");
  });

  test("on a page wider than the screen, against the screen", () => {
    // A phone showing the left 390px of a 498px-wide page, scrolled 200px
    // into a layout viewport that is taller than the screen too.
    const style = placementStyle(
      { edge: "right", offset: 0.9 },
      {
        left: 0,
        top: 200,
        width: 390,
        height: 664,
        layoutWidth: 498,
        layoutHeight: 1048,
      },
    );
    expect(style.right).toBe(108 + OVERLAY_MARGIN);
    // 184px of layout viewport below the screen, then the circle's distance
    // from the bottom of the screen.
    expect(style.bottom).toBe(
      184 + 664 - 0.9 * 664 - OVERLAY_LAUNCHER_SIZE / 2,
    );
  });
});

describe("growth and orientation", () => {
  test("a side edge is vertical, a top or bottom edge horizontal", () => {
    expect(placementOrientation({ edge: "left", offset: 0.3 })).toBe(
      "vertical",
    );
    expect(placementOrientation({ edge: "top", offset: 0.3 })).toBe(
      "horizontal",
    );
  });

  test("grows away from the nearer end of its edge", () => {
    expect(placementGrowth({ edge: "right", offset: 0.2 })).toBe("forward");
    expect(placementGrowth({ edge: "right", offset: 0.8 })).toBe("backward");
    expect(placementGrowth({ edge: "right", offset: 0.5 })).toBe("centre");
  });
});

describe("the eight presets", () => {
  test.each(OVERLAY_DOCKS)("%s is its own nearest dock", (dock) => {
    expect(nearestDock(placementOfDock(dock))).toBe(dock);
  });

  test("the default is the old default, the middle of the right edge", () => {
    expect(nearestDock(DEFAULT_OVERLAY_PLACEMENT)).toBe("right-center");
  });
});

describe("parseStoredPlacement", () => {
  test("reads a placement it wrote", () => {
    const placement = { edge: "left" as const, offset: 0.3 };
    expect(parseStoredPlacement(JSON.stringify(placement))).toEqual(placement);
  });

  test("reads the dock name stored before the menu could be dragged", () => {
    expect(parseStoredPlacement("val-menu-center-bottom")).toEqual({
      edge: "bottom",
      offset: 0.5,
    });
  });

  test("writes a dock name the framework packages can read back", () => {
    expect(legacyDropZoneOf({ edge: "left", offset: 0.9 })).toBe(
      "val-menu-left-bottom",
    );
    expect(
      parseStoredPlacement(legacyDropZoneOf({ edge: "left", offset: 0.9 })),
    ).toEqual({ edge: "bottom", offset: 0 });
  });

  test("ignores what it cannot read", () => {
    expect(parseStoredPlacement(null)).toBeNull();
    expect(parseStoredPlacement("val-menu-nowhere")).toBeNull();
    expect(parseStoredPlacement("{not json")).toBeNull();
    expect(parseStoredPlacement('{"edge":"up","offset":0.5}')).toBeNull();
  });
});
