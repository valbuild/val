import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Fragment,
  ReactNode,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useValSystem } from "../../stores/react/SystemContext";
import { Button } from "../designSystem/button";

/**
 * Records below this many keys render plainly, exactly as before: a nested
 * scroll container is a real UX change, and it is not worth imposing on the
 * ordinary small record. Above it the list virtualizes.
 *
 * It also bounds the un-virtualized `.jsonValues()` load: at most this many keys
 * are requested at once, which is one or two batches.
 */
const VIRTUALIZE_THRESHOLD = 50;
/**
 * Fallback height for the virtualized viewport, before it has been measured.
 *
 * A constant used to be the ANSWER, and that is what made a long record awkward
 * to use: an 800px box inside the editor's own scroller means two scrollbars,
 * and the outer one moves the whole list — so scrolling anywhere but exactly
 * inside the box heaves a thousand rows up and down. The list is sized to the
 * room it actually has instead; see {@link useFitHeight}.
 */
const VIEWPORT_FALLBACK_HEIGHT = 800;
/** Below this the viewport is too short to be a list at all. */
const VIEWPORT_MIN_HEIGHT = 320;
/** Room left under the list, so it does not end flush against the edge. */
const VIEWPORT_BOTTOM_GUTTER = 16;

/**
 * The height that makes this list end where its container does.
 *
 * ## Why it is measured rather than a `calc`
 *
 * What is below the list varies — the editor's own bottom padding, the mobile
 * bottom bar, a canvas pane — and what is ABOVE it varies more: the module
 * header, other fields, however many of them the schema has. Only the element
 * itself knows where it ended up.
 *
 * ## Why it does NOT re-measure on scroll
 *
 * `top` changes as an ancestor scrolls, so re-measuring there would grow and
 * shrink the list under the pointer — the jitter this exists to remove, in a
 * more confusing form. Measured at layout and on resize: the height is "the
 * room this list has", which does not depend on where the page is scrolled to.
 */
function useFitHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(VIEWPORT_FALLBACK_HEIGHT);
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const measure = () => {
      const top = node.getBoundingClientRect().top;
      /**
       * The bottom of whatever scrolls this list, or the window.
       *
       * A scrolling ancestor's own bottom is the real floor: the editor column
       * is inset from the viewport by the shell's floating chrome, and sizing to
       * the window would push the last rows underneath it.
       */
      const scroller = findScrollParent(node);
      const bottom =
        scroller === null
          ? window.innerHeight
          : scroller.getBoundingClientRect().bottom;
      setHeight(
        Math.max(VIEWPORT_MIN_HEIGHT, bottom - top - VIEWPORT_BOTTOM_GUTTER),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    /**
     * And when the layout around it changes without a resize: opening the canvas
     * halves the column, and a panel opening or a field expanding moves this
     * list up or down the page.
     */
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    const scroller = findScrollParent(node);
    if (scroller !== null) observer.observe(scroller);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [ref]);
  return height;
}

/** The nearest ancestor that scrolls, if any. */
function findScrollParent(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current !== null) {
    const overflowY = getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Renders a record's rows, virtualizing once there are enough of them, and — for
 * a `.jsonValues()` record — loading the content of ONLY the rows currently
 * rendered.
 *
 * Why this exists: every row renders a preview of its entry, and for a
 * jsonValues record that preview needs the entry's content. Rendering all rows
 * therefore loaded every entry, which is exactly what `.jsonValues()` is meant
 * to avoid. Virtualizing means un-rendered rows cost nothing, and the visible
 * window is requested in one batch.
 */
export function VirtualizedRecordList({
  moduleFilePath,
  keys,
  estimatedRowHeight,
  lazyEntries,
  className,
  renderRow,
}: {
  moduleFilePath: ModuleFilePath;
  /** Record keys, in source order. */
  keys: string[];
  estimatedRowHeight: number;
  /**
   * True when this record's rows must be LOADED rather than read from source —
   * `.jsonValues()` and `.external()` alike. The two differ in where the content
   * comes from, which is `SourceStore`'s business, not this list's.
   */
  lazyEntries: boolean;
  className?: string;
  renderRow: (key: string) => ReactNode;
}) {
  const val = useValSystem();
  const parentRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = keys.length > VIRTUALIZE_THRESHOLD;
  const fitHeight = useFitHeight(parentRef);

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? keys.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  // The rendered window, as plain indices: depending on these rather than on the
  // virtual-item objects keeps the effect below from re-running on every scroll
  // frame that happens to render the same rows.
  const firstIndex = virtualItems.length > 0 ? virtualItems[0].index : -1;
  const lastIndex =
    virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  /** The keys actually rendered — the window whose content we need. */
  const windowKeys = useMemo(() => {
    if (!shouldVirtualize) {
      return keys;
    }
    if (firstIndex < 0) {
      return [];
    }
    return keys.slice(firstIndex, lastIndex + 1);
  }, [shouldVirtualize, keys, firstIndex, lastIndex]);

  // `keys` is a fresh array on every render (Object.keys), so the effect below
  // depends on the window's CONTENT, not its identity — otherwise it re-runs on
  // every render of a long list. The keys themselves are read through a ref so
  // they never have to be a dependency (joining and re-splitting would corrupt
  // any key containing the separator).
  const windowKeysId = windowKeys.join("\u0000");
  const windowKeysRef = useRef(windowKeys);
  windowKeysRef.current = windowKeys;
  /**
   * Keys this list has already asked for, ever.
   *
   * Monotonic on purpose, and it is what makes windowed loading CONVERGE.
   * Entry content is taller than the skeleton it replaces, so every arrival
   * re-renders these rows and moves the window — which asked again, brought more
   * entries, and moved it again. Bounded by the key count in principle, but it
   * walks it as one cascade of nested updates and React gives up first: the
   * record route died with "Maximum update depth exceeded" from inside a ref
   * callback, naming nothing about entries.
   *
   * Asking once per key breaks the feedback: the window may still shift as
   * content lands, but a shift that reveals no NEW key now costs nothing, so it
   * settles. `SourceStore` skips entries it already has, so this is not about
   * request count — it is about not re-entering the announcement that caused the
   * shift.
   */
  const requestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!lazyEntries || windowKeysRef.current.length === 0) {
      return;
    }
    const fresh = windowKeysRef.current.filter(
      (key) => !requestedRef.current.has(key),
    );
    if (fresh.length === 0) {
      return;
    }
    for (const key of fresh) {
      requestedRef.current.add(key);
    }
    // Entries already here are skipped, and concurrent requests for one entry
    // share a single fetch (`SourceStore.loadEntry`), so a fast scroll that
    // crosses several windows does not fan out into duplicate requests.
    void val?.system.sourceStore.loadEntries(moduleFilePath, fresh);
  }, [val, moduleFilePath, lazyEntries, windowKeysId]);

  // A different module in the same component instance is a different record, so
  // what was asked for no longer applies.
  useEffect(() => {
    requestedRef.current = new Set();
  }, [moduleFilePath]);

  if (!shouldVirtualize) {
    return (
      <div className={className}>
        {keys.map((key) => (
          <Fragment key={key}>{renderRow(key)}</Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className="overflow-auto"
      style={{
        contain: "strict",
        // The room it has, or less if the list is shorter than that.
        height: Math.min(keys.length * estimatedRowHeight, fitHeight),
      }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const key = keys[virtualRow.index];
          if (key === undefined) {
            return null;
          }
          return (
            <div
              key={key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              {renderRow(key)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Placeholder for a `.jsonValues()` row whose content has not loaded yet.
 *
 * Deliberately NOT the row's real preview: a preview reading an un-loaded marker
 * is what made jsonValues record lists render a wall of spinners. The height is
 * fixed to the row estimate so the virtualizer's measurements do not jump as
 * content lands.
 */
export function RecordRowSkeleton({
  path,
  height,
}: {
  path: SourcePath;
  height: number;
}) {
  return (
    <div
      id={path}
      style={{ height }}
      className="flex flex-col gap-2 justify-center animate-pulse"
      aria-busy="true"
    >
      <div className="w-1/3 h-3 rounded bg-bg-secondary" />
      <div className="w-2/3 h-3 rounded bg-bg-secondary" />
    </div>
  );
}

/**
 * A `.jsonValues()` row whose content FAILED to load.
 *
 * It replaces the row entirely rather than sitting inside it: the row is
 * click-to-navigate, and there is nothing to navigate to until the entry loads.
 * A failure is memoized by the engine (so it does not refetch on every render),
 * which means without an explicit retry the row would pulse as a skeleton
 * forever.
 */
export function RecordRowError({
  path,
  label,
  message,
  height,
  onRetry,
}: {
  path: SourcePath;
  label: string;
  message: string;
  height: number;
  onRetry: () => void;
}) {
  return (
    <div
      id={path}
      style={{ minHeight: height }}
      className="flex flex-col gap-2 justify-center p-4 rounded-md border border-border-error-primary"
    >
      <div className="font-semibold text-md">{label}</div>
      <div className="text-sm text-fg-error-primary">{message}</div>
      <div>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
