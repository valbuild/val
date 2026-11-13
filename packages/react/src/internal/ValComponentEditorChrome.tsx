"use client";

import { Internal, type SourcePath } from "@valbuild/core";
import {
  DEFAULT_CANVAS_SELECTION,
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

/** The Studio's selection colour: its `theme` message, or Val's green. */
function useSelectionColor(): string {
  const [color, setColor] = useState(DEFAULT_CANVAS_SELECTION);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      if (!isValCanvasStudioMessage(event.data)) return;
      if (event.data.type === "theme") {
        setColor(event.data.selection);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  return color;
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

/** Above the page, below nothing: the controls must not be covered. */
const CONTROL_Z_INDEX = 2147483000;

/** How near the edge of the window a drag starts scrolling, and how fast. */
const SCROLL_EDGE = 48;
const SCROLL_STEP = 14;

type Drag = { from: number; slot: number };

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
  const [drag, setDrag] = useState<Drag | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
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
  const dragging = drag !== null;

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
      const next = index === -1 ? null : index;
      setHover((current) => {
        if (current !== next && next !== null) {
          measure();
        }
        return next;
      });
    };
    const onLeave = () => setHover(null);
    document.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [dragging, listRef, measure]);

  // A confirmation is for the item it was asked on, and no other.
  useEffect(() => {
    setConfirmingRemove(false);
  }, [hover]);

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
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      if (event.clientY < SCROLL_EDGE) {
        window.scrollBy(0, -SCROLL_STEP);
      } else if (event.clientY > window.innerHeight - SCROLL_EDGE) {
        window.scrollBy(0, SCROLL_STEP);
      }
      setRects(measureItems());
      // In the window's own coordinates, which is what the pointer is in
      const slot = slotAt(itemsOf(listRef.current).map(rectOf), {
        x: event.clientX,
        y: event.clientY,
      });
      setDrag((current) => current && { from: current.from, slot });
    };
    const onUp = () => {
      setDrag((current) => {
        if (current !== null) {
          const to = moveTarget(current.from, current.slot);
          if (to !== null) {
            sendEdit({ op: "move", list: path, from: current.from, to });
          }
        }
        return null;
      });
      setHover(null);
    };
    const onCancel = () => setDrag(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrag(null);
      }
    };
    const selectable = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.userSelect = selectable;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onKey);
    };
  }, [dragging, listRef, path, measureItems]);

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
  const shown = drag !== null ? drag.from : hover;
  const rect = shown !== null ? rects[shown] : undefined;

  let controls: ReactNode = null;
  if (drag !== null) {
    const before = rects[drag.slot];
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
        {line !== null && moveTarget(drag.from, drag.slot) !== null && (
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
            // Inside the item's corner, and never off the top of the window:
            // a section taller than the window keeps its controls in reach.
            top: Math.max(rect.top + 8, 8),
            left: Math.max(rect.left + rect.width - 8, 8),
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
              setDrag({ from: hover, slot: hover });
            }}
          >
            <Icon name="grip" />
          </ToolbarButton>
          <ToolbarButton
            title="Move up"
            disabled={hover === 0}
            onClick={() => {
              sendEdit({ op: "move", list: path, from: hover, to: hover - 1 });
              setHover(null);
            }}
          >
            <Icon name={horizontal ? "left" : "up"} />
          </ToolbarButton>
          <ToolbarButton
            title="Move down"
            disabled={hover === count - 1}
            onClick={() => {
              sendEdit({ op: "move", list: path, from: hover, to: hover + 1 });
              setHover(null);
            }}
          >
            <Icon name={horizontal ? "right" : "down"} />
          </ToolbarButton>
          <ToolbarButton title="Edit the content" onClick={() => open(hover)}>
            <Icon name="pencil" />
          </ToolbarButton>
          {confirmingRemove ? (
            <ToolbarButton
              title="Remove this section"
              style={{ background: "#dc2626", padding: "0 8px" }}
              onClick={() => {
                sendEdit({ op: "remove", list: path, index: hover });
                setHover(null);
              }}
            >
              Remove?
            </ToolbarButton>
          ) : (
            <ToolbarButton
              title="Remove this section"
              onClick={() => setConfirmingRemove(true)}
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
      data-val-component-controls=""
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

const ICON_PATHS: Record<IconName, ReactNode> = {
  grip: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  ),
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  down: <path d="M12 5v14M19 12l-7 7-7-7" />,
  left: <path d="M19 12H5M12 19l-7-7 7-7" />,
  right: <path d="M5 12h14M12 5l7 7-7 7" />,
  pencil: (
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5ZM15 5l4 4" />
  ),
  trash: (
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
  ),
  plus: <path d="M5 12h14M12 5v14" />,
};

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
      {ICON_PATHS[name]}
    </svg>
  );
}
