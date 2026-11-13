"use client";

import { Internal, type SourcePath } from "@valbuild/core";
import {
  DEFAULT_CANVAS_SELECTION,
  VAL_CANVAS_CONTROLS_ATTRIBUTE,
  VAL_CANVAS_MESSAGE,
  isValCanvasFrame,
  isValCanvasStudioMessage,
  type ValCanvasComponentEdit,
  type ValCanvasPageMessage,
} from "@valbuild/shared/client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * On the element around each component `ValComponentEditor` renders. It has
 * no value: an item is known by its PLACE among its siblings, which is what
 * an edit to a list is made of.
 */
export const VAL_COMPONENT_ATTRIBUTE = "data-val-component";

/** On the element around a list, with the list's path once there is one. */
export const VAL_COMPONENT_LIST_ATTRIBUTE = "data-val-component-list";

/** A rectangle in the viewport: what `getBoundingClientRect` gives. */
export type ItemRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/**
 * Whether a list runs across rather than down: its first two items sit side
 * by side. A list of one has no direction, and down is the answer that costs
 * nothing when it is wrong.
 */
export function isHorizontal(rects: readonly ItemRect[]): boolean {
  const [first, second] = rects;
  if (first === undefined || second === undefined) {
    return false;
  }
  return second.left >= first.left + first.width / 2;
}

/**
 * Where a dragged item would land if it were let go at `point`: the number of
 * items that come before that place, so `0` is the top of the list and
 * `rects.length` is the end of it.
 *
 * An item comes before the pointer once the pointer has passed its middle,
 * which is what makes a section give way when it is half covered instead of
 * at its very edge.
 */
export function slotAt(
  rects: readonly ItemRect[],
  point: { x: number; y: number },
): number {
  const horizontal = isHorizontal(rects);
  let slot = 0;
  for (const rect of rects) {
    const middle = horizontal
      ? rect.left + rect.width / 2
      : rect.top + rect.height / 2;
    if ((horizontal ? point.x : point.y) < middle) {
      break;
    }
    slot++;
  }
  return slot;
}

/**
 * The index an item ends up at when it is dropped in `slot`, or `null` when
 * that is where it already is. The two slots on either side of an item are
 * both its own place; past it, taking the item out moves everything up one.
 */
export function moveTarget(from: number, slot: number): number | null {
  if (slot === from || slot === from + 1) {
    return null;
  }
  return slot > from ? slot - 1 : slot;
}

/**
 * The element around a list of components, and - in the Studio's canvas - the
 * controls to arrange it. See `ValComponentEditor`.
 *
 * The controls exist only when two things are true: the page is in the
 * canvas frame, so there is a Studio to hear what was asked for, and the list
 * has a path, which it has when the page is showing draft content. Anywhere
 * else this is one element and its children.
 */
export function ValComponentList({
  path,
  className,
  count,
  children,
}: {
  path: SourcePath | undefined;
  className?: string;
  count: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inCanvas = useIsCanvasFrame();
  const editing = inCanvas && path !== undefined;
  return (
    <div
      ref={ref}
      className={className}
      {...{ [VAL_COMPONENT_LIST_ATTRIBUTE]: path ?? "" }}
    >
      {children}
      {editing && count === 0 && <EmptyList path={path} />}
      {editing && <ListControls listRef={ref} path={path} />}
    </div>
  );
}

function subscribeToNothing() {
  return () => {};
}

/**
 * Whether this document is the Studio's canvas. `false` on the server and
 * for the first render in the browser, so what is hydrated is what was sent.
 */
function useIsCanvasFrame(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => isValCanvasFrame(window.location.search, readParentPathname()),
    () => false,
  );
}

function readParentPathname(): string | null {
  try {
    if (window.parent === window) {
      return null;
    }
    return window.parent.location.pathname;
  } catch {
    // A parent on another origin: not the Studio, whose canvas is the same app
    return null;
  }
}

function send(message: ValCanvasPageMessage) {
  // To the Studio, which is the same app: nothing on another origin is told
  // what an editor did.
  window.parent.postMessage(message, window.location.origin);
}

function sendEdit(edit: ValCanvasComponentEdit) {
  send({ val: VAL_CANVAS_MESSAGE, type: "componentEdit", edit });
}

/*
 * The Studio's selection colour, for every list on the page.
 *
 * Kept here and not in each list's state: the Studio says it once, when the
 * page announces itself, and a list that is rendered later - one inside a
 * section that was just added - was not there to hear it.
 */
let selectionColor: string = DEFAULT_CANVAS_SELECTION;
const selectionColorListeners = new Set<() => void>();
let listeningForSelectionColor = false;

function subscribeToSelectionColor(onChange: () => void) {
  if (!listeningForSelectionColor) {
    listeningForSelectionColor = true;
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isValCanvasStudioMessage(event.data)) return;
      if (event.data.type !== "theme") return;
      selectionColor = event.data.selection;
      selectionColorListeners.forEach((listener) => listener());
    });
  }
  selectionColorListeners.add(onChange);
  return () => {
    selectionColorListeners.delete(onChange);
  };
}

/** The Studio's selection colour: its `theme` message, or Val's green. */
function useSelectionColor(): string {
  return useSyncExternalStore(
    subscribeToSelectionColor,
    () => selectionColor,
    () => DEFAULT_CANVAS_SELECTION,
  );
}

/** A list with nothing in it has nothing to hover: the way in is a button. */
function EmptyList({ path }: { path: SourcePath }) {
  const color = useSelectionColor();
  return (
    <button
      type="button"
      onClick={() => sendEdit({ op: "insert", list: path, index: 0 })}
      style={{
        all: "unset",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        minHeight: 96,
        border: `1px dashed ${color}`,
        borderRadius: 8,
        color,
        font: CONTROL_FONT,
        cursor: "pointer",
      }}
    >
      <Icon name="plus" />
      Add a section
    </button>
  );
}

const CONTROL_FONT =
  '500 13px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

/** The toolbar's height: its buttons, and the padding around them. */
const TOOLBAR_HEIGHT = 32;

/** Above the page, below nothing: the controls must not be covered. */
const CONTROL_Z_INDEX = 2147483000;

/** How near the edge of the window a drag starts scrolling, and how fast. */
const SCROLL_EDGE = 48;
const SCROLL_STEP = 14;

function itemsOf(list: HTMLElement | null): HTMLElement[] {
  if (list === null) {
    return [];
  }
  const items: HTMLElement[] = [];
  for (const child of Array.from(list.children)) {
    if (
      child instanceof HTMLElement &&
      child.hasAttribute(VAL_COMPONENT_ATTRIBUTE)
    ) {
      items.push(child);
    }
  }
  return items;
}

/**
 * A rectangle measured in the window, as offsets from `origin`: where the
 * controls' layer actually is, which is the window's corner unless an
 * ancestor made itself the containing block of fixed elements.
 */
export function relativeTo(
  rect: ItemRect,
  origin: { x: number; y: number },
): ItemRect {
  return {
    top: rect.top - origin.y,
    left: rect.left - origin.x,
    width: rect.width,
    height: rect.height,
  };
}

function rectOf(element: HTMLElement): ItemRect {
  const { top, left, width, height } = element.getBoundingClientRect();
  return { top, left, width, height };
}

/**
 * The controls on a list, drawn over the page rather than in it: a layer of
 * its own, positioned from where the items are, so nothing about the page's
 * own layout has to make room for them.
 *
 * The layer is the list's last child and not a portal on `<body>`, which
 * would need `react-dom`: this file is reached from `val.config.ts` (through
 * the framework package's entry), which Val also evaluates where there is no
 * DOM to import. It is `position: fixed`, so it takes no room in the list;
 * and it is measured rather than assumed to sit at the window's corner,
 * because an ancestor with a `transform` or a `filter` moves a fixed
 * element's origin to itself ({@link relativeTo}).
 */
function ListControls({
  listRef,
  path,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  path: SourcePath;
}) {
  const color = useSelectionColor();
  const layerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // The item being dragged, and the place it would land in if let go now
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragSlot, setDragSlot] = useState(0);
  // The item whose removal is waiting for a second click
  const [confirming, setConfirming] = useState<number | null>(null);
  // Where the items are, in the window. Measured when something could have
  // moved them - the pointer reaching another item, a scroll, a resize, a
  // drag - and never while rendering.
  const [rects, setRects] = useState<readonly ItemRect[]>([]);
  const measureItems = useCallback((): ItemRect[] => {
    const layer = layerRef.current?.getBoundingClientRect();
    const origin = { x: layer?.left ?? 0, y: layer?.top ?? 0 };
    return itemsOf(listRef.current).map((item) =>
      relativeTo(rectOf(item), origin),
    );
  }, [listRef]);
  const measure = useCallback(() => {
    setRects(measureItems());
  }, [measureItems]);
  // What `hover` is, for the handlers: they compare against it on every move
  // of the pointer, and must not wait for a render to know it.
  const hovered = useRef<number | null>(null);
  const hoverOn = useCallback(
    (next: number | null) => {
      if (hovered.current === next) return;
      hovered.current = next;
      setHover(next);
      // A confirmation is for the item it was asked on, and no other
      setConfirming(null);
      if (next !== null) {
        measure();
      }
    },
    [measure],
  );
  const dragging = dragFrom !== null;

  // Which item the pointer is over.
  useEffect(() => {
    if (dragging) return;
    const onMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // On the controls themselves: they belong to the item they are on.
      if (layerRef.current?.contains(target)) return;
      // The NEAREST component only, so a list inside a component of another
      // list answers for its own items and the outer one stays out of it.
      const item = target.closest(`[${VAL_COMPONENT_ATTRIBUTE}]`);
      const index =
        item instanceof HTMLElement && item.parentElement === listRef.current
          ? itemsOf(listRef.current).indexOf(item)
          : -1;
      hoverOn(index === -1 ? null : index);
    };
    const onLeave = () => hoverOn(null);
    document.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [dragging, listRef, hoverOn]);

  // The page scrolls and resizes under the controls.
  const active = hover !== null || dragging;
  useEffect(() => {
    if (!active) return;
    window.addEventListener("scroll", measure, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, { capture: true });
      window.removeEventListener("resize", measure);
    };
  }, [active, measure]);

  // A drag, once started, is the whole document's: the pointer leaves the
  // handle at once, and has to be followed wherever it goes.
  useEffect(() => {
    if (dragFrom === null) return;
    // Kept here as well as in state: letting go has to know the slot the
    // pointer is over NOW, and must send its edit exactly once - from the
    // handler, never from a state updater, which React may run twice.
    let slot = dragFrom;
    let pointer: { x: number; y: number } | null = null;
    const place = () => {
      if (pointer === null) return;
      setRects(measureItems());
      // In the window's own coordinates, which is what the pointer is in
      slot = slotAt(itemsOf(listRef.current).map(rectOf), pointer);
      setDragSlot(slot);
    };
    // Scrolling while the pointer rests near an edge: a pointer that is held
    // still sends no events, so the page is moved on every frame instead.
    let frame = requestAnimationFrame(function scroll() {
      frame = requestAnimationFrame(scroll);
      if (pointer === null) return;
      const step =
        pointer.y < SCROLL_EDGE
          ? -SCROLL_STEP
          : pointer.y > window.innerHeight - SCROLL_EDGE
            ? SCROLL_STEP
            : 0;
      if (step !== 0) {
        window.scrollBy(0, step);
        place();
      }
    });
    const end = () => {
      setDragFrom(null);
      hoverOn(null);
    };
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      place();
    };
    const onUp = () => {
      const to = moveTarget(dragFrom, slot);
      if (to !== null) {
        sendEdit({ op: "move", list: path, from: dragFrom, to });
      }
      end();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        end();
      }
    };
    const selectable = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", end);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.userSelect = selectable;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", end);
      document.removeEventListener("keydown", onKey);
    };
  }, [dragFrom, listRef, path, measureItems, hoverOn]);

  const open = useCallback(
    (index: number) => {
      const itemPath = Internal.createValPathOfItem(path, index);
      if (itemPath !== undefined) {
        send({ val: VAL_CANVAS_MESSAGE, type: "clicked", paths: [itemPath] });
      }
    },
    [path],
  );

  const horizontal = isHorizontal(rects);
  const shown = dragFrom !== null ? dragFrom : hover;
  const rect = shown !== null ? rects[shown] : undefined;

  let controls: ReactNode = null;
  if (dragFrom !== null) {
    const before = rects[dragSlot];
    const last = rects[rects.length - 1];
    const line: CSSProperties | null =
      before !== undefined
        ? horizontal
          ? { top: before.top, left: before.left - 2, height: before.height }
          : { top: before.top - 2, left: before.left, width: before.width }
        : last !== undefined
          ? horizontal
            ? {
                top: last.top,
                left: last.left + last.width - 2,
                height: last.height,
              }
            : {
                top: last.top + last.height - 2,
                left: last.left,
                width: last.width,
              }
          : null;
    controls = (
      <>
        {rect !== undefined && (
          <div
            style={{
              position: "absolute",
              ...rect,
              background: color,
              opacity: 0.12,
              pointerEvents: "none",
            }}
          />
        )}
        {line !== null && moveTarget(dragFrom, dragSlot) !== null && (
          <div
            data-val-component-drop=""
            style={{
              position: "absolute",
              ...(horizontal ? { width: 4 } : { height: 4 }),
              ...line,
              background: color,
              borderRadius: 2,
              pointerEvents: "none",
            }}
          />
        )}
      </>
    );
  } else if (hover !== null && rect !== undefined) {
    const count = rects.length;
    controls = (
      <>
        <div
          style={{
            position: "absolute",
            ...rect,
            outline: `2px solid ${color}`,
            outlineOffset: -2,
            pointerEvents: "none",
          }}
        />
        <AddButton
          title="Add a section before this one"
          color={color}
          style={
            horizontal
              ? { top: rect.top + rect.height / 2 - 12, left: rect.left - 12 }
              : { top: rect.top - 12, left: rect.left + rect.width / 2 - 12 }
          }
          onClick={() => sendEdit({ op: "insert", list: path, index: hover })}
        />
        <AddButton
          title="Add a section after this one"
          color={color}
          style={
            horizontal
              ? {
                  top: rect.top + rect.height / 2 - 12,
                  left: rect.left + rect.width - 12,
                }
              : {
                  top: rect.top + rect.height - 12,
                  left: rect.left + rect.width / 2 - 12,
                }
          }
          onClick={() =>
            sendEdit({ op: "insert", list: path, index: hover + 1 })
          }
        />
        <div
          data-val-component-toolbar=""
          style={{
            position: "absolute",
            // On top of the item's corner rather than in it, so a small
            // component is not covered by its own controls - and touching
            // it, so the pointer reaches them without crossing anything
            // else. Never off the top of the window: a section that starts
            // above it keeps its controls in reach, inside its corner.
            top: Math.max(rect.top - TOOLBAR_HEIGHT, 8),
            left: Math.max(rect.left + rect.width, TOOLBAR_HEIGHT * 5),
            transform: "translateX(-100%)",
            display: "flex",
            alignItems: "center",
            gap: 2,
            padding: 3,
            borderRadius: 8,
            background: "#18181b",
            color: "#fafafa",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.28)",
            font: CONTROL_FONT,
            whiteSpace: "nowrap",
          }}
        >
          <ToolbarButton
            title="Drag to move"
            style={{ cursor: "grab", touchAction: "none" }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              setDragSlot(hover);
              setDragFrom(hover);
            }}
          >
            <Icon name="grip" />
          </ToolbarButton>
          <ToolbarButton
            title="Move up"
            disabled={hover === 0}
            onClick={() => {
              sendEdit({ op: "move", list: path, from: hover, to: hover - 1 });
              hoverOn(null);
            }}
          >
            <Icon name={horizontal ? "left" : "up"} />
          </ToolbarButton>
          <ToolbarButton
            title="Move down"
            disabled={hover === count - 1}
            onClick={() => {
              sendEdit({ op: "move", list: path, from: hover, to: hover + 1 });
              hoverOn(null);
            }}
          >
            <Icon name={horizontal ? "right" : "down"} />
          </ToolbarButton>
          <ToolbarButton title="Edit the content" onClick={() => open(hover)}>
            <Icon name="pencil" />
          </ToolbarButton>
          {confirming === hover ? (
            <ToolbarButton
              title="Remove this section"
              style={{ background: "#dc2626", padding: "0 8px" }}
              onClick={() => {
                sendEdit({ op: "remove", list: path, index: hover });
                hoverOn(null);
              }}
            >
              Remove?
            </ToolbarButton>
          ) : (
            <ToolbarButton
              title="Remove this section"
              onClick={() => setConfirming(hover)}
            >
              <Icon name="trash" />
            </ToolbarButton>
          )}
        </div>
      </>
    );
  }

  return (
    <div
      ref={layerRef}
      {...{ [VAL_CANVAS_CONTROLS_ATTRIBUTE]: "" }}
      style={{ position: "fixed", top: 0, left: 0, zIndex: CONTROL_Z_INDEX }}
    >
      {controls}
    </div>
  );
}

function ToolbarButton({
  title,
  disabled,
  style,
  onClick,
  onPointerDown,
  children,
}: {
  title: string;
  disabled?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      style={{
        all: "unset",
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 26,
        height: 26,
        borderRadius: 5,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.35 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function AddButton({
  title,
  color,
  style,
  onClick,
}: {
  title: string;
  color: string;
  style: CSSProperties;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-val-component-add=""
      onClick={onClick}
      style={{
        all: "unset",
        boxSizing: "border-box",
        position: "absolute",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 12,
        background: color,
        color: "#ffffff",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
        cursor: "pointer",
        ...style,
      }}
    >
      <Icon name="plus" />
    </button>
  );
}

type IconName =
  | "grip"
  | "up"
  | "down"
  | "left"
  | "right"
  | "pencil"
  | "trash"
  | "plus";

/**
 * A function, and not a table of elements: a table is built when this file
 * is imported, and this file is imported wherever `val.config.ts` is - the
 * CLI and the language server included, which evaluate it with no React to
 * build an element with. Nothing here may run before a component renders.
 */
function iconPaths(name: IconName): ReactNode {
  switch (name) {
    case "grip":
      return (
        <>
          <circle cx="9" cy="6" r="1" />
          <circle cx="9" cy="12" r="1" />
          <circle cx="9" cy="18" r="1" />
          <circle cx="15" cy="6" r="1" />
          <circle cx="15" cy="12" r="1" />
          <circle cx="15" cy="18" r="1" />
        </>
      );
    case "up":
      return <path d="M12 19V5M5 12l7-7 7 7" />;
    case "down":
      return <path d="M12 5v14M19 12l-7 7-7-7" />;
    case "left":
      return <path d="M19 12H5M12 19l-7-7 7-7" />;
    case "right":
      return <path d="M5 12h14M12 5l7 7-7 7" />;
    case "pencil":
      return (
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5ZM15 5l4 4" />
      );
    case "trash":
      return (
        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
      );
    case "plus":
      return <path d="M5 12h14M12 5v14" />;
  }
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths(name)}
    </svg>
  );
}
