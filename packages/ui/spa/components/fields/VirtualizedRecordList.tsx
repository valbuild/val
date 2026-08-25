import { ModuleFilePath, SourcePath } from "@valbuild/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, ReactNode, useEffect, useMemo, useRef } from "react";
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
/** Height of the virtualized scroll viewport. */
const VIEWPORT_MAX_HEIGHT = 800;

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
  jsonValues,
  className,
  renderRow,
}: {
  moduleFilePath: ModuleFilePath;
  /** Record keys, in source order. */
  keys: string[];
  estimatedRowHeight: number;
  /** True when this is a `.jsonValues()` record, whose rows must be loaded. */
  jsonValues: boolean;
  className?: string;
  renderRow: (key: string) => ReactNode;
}) {
  const val = useValSystem();
  const parentRef = useRef<HTMLDivElement>(null);
  const shouldVirtualize = keys.length > VIRTUALIZE_THRESHOLD;

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
    if (!jsonValues || windowKeysRef.current.length === 0) {
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
  }, [val, moduleFilePath, jsonValues, windowKeysId]);

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
        height: Math.min(keys.length * estimatedRowHeight, VIEWPORT_MAX_HEIGHT),
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
