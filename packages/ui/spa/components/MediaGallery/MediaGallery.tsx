import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { VIRTUALIZE_THRESHOLD } from "../fields/VirtualizedRecordList";
import { Grid, List, Search, Upload, UploadCloud } from "lucide-react";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";
import { MediaThumbnail } from "../MediaThumbnail";
import { MediaInspector } from "./MediaInspector";
import { useFillScrollContainer } from "./useFillScrollContainer";
import { MediaTile, NewBadge, UploadTile } from "./MediaTile";
import { factsOf, newFirst } from "./format";
import type { MediaGalleryProps, MediaItem, MediaKind } from "./types";
import { Spinner } from "../designSystem/spinner";

const NOUN: Record<MediaKind, { one: string; many: string }> = {
  images: { one: "image", many: "images" },
  videos: { one: "video", many: "videos" },
  files: { one: "file", many: "files" },
};

/**
 * A gallery — `s.imagedir()`, `s.videodir()`, `s.filedir()` — as one layout:
 * a grid (or list) of entries, and the open entry in a panel beside it.
 *
 * Purely presentational: every entry arrives resolved and every change goes
 * out through a callback. `ModuleGallery` is what connects it to a module.
 */
export function MediaGallery({
  kind,
  items,
  uploads = [],
  selectedRef,
  onSelect,
  onUploadClick,
  uploadDisabled,
  isDraggingOver,
  onDescriptionChange,
  onRename,
  onDelete,
  deleteBlockedReason,
  renderUsage,
  renderInspector,
  uploading,
  defaultView = "grid",
  readonly,
  fillContainer,
}: MediaGalleryProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  /**
   * The gallery is the page: it takes the height that is left, and its grid
   * and its panel scroll inside it. A panel as tall as its content made the
   * whole page scroll, and the grid scrolled away with it.
   */
  const fillHeight = useFillScrollContainer(rootRef, {
    enabled: !!fillContainer,
    min: 280,
  });
  /**
   * The grid and the list scroll in here, and window themselves to it. State,
   * not a ref: the window is measured from a child, whose effects run before
   * this element's ref is attached.
   */
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<"grid" | "list">(defaultView);
  const [query, setQuery] = useState("");
  const noun = NOUN[kind];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return newFirst(
      q
        ? items.filter(
            (item) =>
              item.name.toLowerCase().includes(q) ||
              (item.description ?? "").toLowerCase().includes(q),
          )
        : items,
    );
  }, [items, query]);
  /**
   * The open entry, held on to while its ref names nothing.
   *
   * A rename is a `move` of the record entry, and it lands BEFORE the rename
   * resolves and the selection follows the file to its new key. Without this
   * the panel unmounted in that gap, taking the busy name input and any
   * message the rename came back with along with it.
   */
  const lastSelected = useRef<MediaItem | null>(null);
  const found = items.find((item) => item.ref === selectedRef) ?? null;
  if (found) {
    lastSelected.current = found;
  }
  const selected =
    found ??
    (selectedRef !== null && lastSelected.current?.ref === selectedRef
      ? lastSelected.current
      : null);
  /**
   * Past this many entries only the ones on screen are rendered: every tile
   * is an image to decode, and a library of 10,000 was 10,000 `<img>`, 115 MB
   * and a 105 s scroll -- at 100,000 the tab crashed.
   */
  const windowed =
    (view === "grid" ? uploads.length + shown.length : shown.length) >
    VIRTUALIZE_THRESHOLD;

  return (
    <div
      ref={rootRef}
      style={
        fillHeight !== null
          ? { height: fillHeight }
          : windowed
            ? // A windowed grid shows what fits, so it needs a bottom before
              // it is measured: unbounded, every row would fit.
              { maxHeight: "100vh" }
            : undefined
      }
      className="relative flex min-h-[17.5rem] flex-col overflow-hidden rounded-lg border border-border-secondary bg-bg-primary"
    >
      <div className="flex items-center gap-2 border-b border-border-secondary px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary-alt"
          />
          <Input
            value={query}
            onChange={(ev) => setQuery(ev.target.value)}
            placeholder={`Search ${noun.many}…`}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div
          className="flex rounded-md border border-border-secondary p-0.5"
          role="group"
          aria-label="View"
        >
          <ViewButton
            active={view === "grid"}
            label="Grid"
            onClick={() => setView("grid")}
          >
            <Grid size={14} />
          </ViewButton>
          <ViewButton
            active={view === "list"}
            label="List"
            onClick={() => setView("list")}
          >
            <List size={14} />
          </ViewButton>
        </div>
        {onUploadClick && !readonly && (
          <button
            type="button"
            onClick={onUploadClick}
            // `uploadDisabled` is a remote gallery waiting on its settings: an
            // upload started now could only fail, so it is not offered yet.
            disabled={uploadDisabled || uploading}
            title="Upload file"
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-bg-brand-primary px-3 text-xs font-medium text-fg-brand-primary hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Spinner size={14} /> : <Upload size={14} />}
            Upload
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={setScroller} className="min-w-0 flex-1 overflow-y-auto p-2">
          {shown.length === 0 && uploads.length === 0 ? (
            <Empty
              noun={noun.many}
              searching={query.trim() !== ""}
              canUpload={!!onUploadClick && !readonly}
            />
          ) : windowed ? (
            <WindowedCells
              scroller={scroller}
              count={
                view === "grid" ? uploads.length + shown.length : shown.length
              }
              minCellWidthRem={
                view === "list" ? null : kind === "videos" ? 10 : 8
              }
              aspect={kind === "videos" ? 9 / 16 : 1}
              selectedIndex={selectedCellIndex(
                selectedRef,
                shown,
                view === "grid" ? uploads.length : 0,
              )}
              renderCell={(index) => {
                if (view === "list") {
                  const item = shown[index];
                  return (
                    <ListRow
                      key={item.ref}
                      kind={kind}
                      item={item}
                      selected={item.ref === selectedRef}
                      onSelect={onSelect}
                    />
                  );
                }
                if (index < uploads.length) {
                  const upload = uploads[index];
                  return (
                    <UploadTile key={upload.id} kind={kind} upload={upload} />
                  );
                }
                const item = shown[index - uploads.length];
                return (
                  <MediaTile
                    key={item.ref}
                    kind={kind}
                    item={item}
                    selected={item.ref === selectedRef}
                    onSelect={() =>
                      onSelect(item.ref === selectedRef ? null : item.ref)
                    }
                  />
                );
              }}
            />
          ) : view === "grid" ? (
            <div
              className={cn(
                "grid gap-1",
                kind === "videos"
                  ? "grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]"
                  : "grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]",
              )}
            >
              {uploads.map((upload) => (
                <UploadTile key={upload.id} kind={kind} upload={upload} />
              ))}
              {shown.map((item) => (
                <MediaTile
                  key={item.ref}
                  kind={kind}
                  item={item}
                  selected={item.ref === selectedRef}
                  onSelect={() =>
                    onSelect(item.ref === selectedRef ? null : item.ref)
                  }
                />
              ))}
            </div>
          ) : (
            <ListView
              kind={kind}
              items={shown}
              selectedRef={selectedRef}
              onSelect={onSelect}
            />
          )}
        </div>

        {selected && (
          // Beside the grid where there is room; over it where there is not.
          <div className="absolute inset-0 z-10 bg-bg-primary md:static md:z-auto md:min-h-0 md:w-80 md:shrink-0 md:border-l md:border-border-secondary">
            {renderInspector ? (
              renderInspector(selected, () => onSelect(null))
            ) : (
              <MediaInspector
                kind={kind}
                item={selected}
                onClose={() => onSelect(null)}
                onDescriptionChange={
                  onDescriptionChange
                    ? (text) => onDescriptionChange(selected.ref, text)
                    : undefined
                }
                onRename={
                  onRename
                    ? (newBase) => onRename(selected.ref, newBase)
                    : undefined
                }
                onDelete={onDelete ? () => onDelete(selected.ref) : undefined}
                deleteBlockedReason={deleteBlockedReason?.(selected) ?? null}
                usage={renderUsage?.(selected)}
                readonly={readonly}
              />
            )}
          </div>
        )}
      </div>

      {isDraggingOver && !readonly && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg border-2 border-dashed border-border-focus bg-bg-primary/80">
          <div className="flex flex-col items-center gap-2 text-fg-primary">
            <UploadCloud size={28} />
            <span className="text-sm font-medium">
              Drop {noun.many} to upload
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ViewButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded p-1.5 text-fg-secondary hover:text-fg-primary",
        active && "bg-bg-secondary text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

function ListView({
  kind,
  items,
  selectedRef,
  onSelect,
}: {
  kind: MediaKind;
  items: MediaItem[];
  selectedRef: string | null;
  onSelect: (ref: string | null) => void;
}) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => (
        <li key={item.ref}>
          <ListRow
            kind={kind}
            item={item}
            selected={item.ref === selectedRef}
            onSelect={onSelect}
          />
        </li>
      ))}
    </ul>
  );
}

/** One entry of the list view. */
function ListRow({
  kind,
  item,
  selected,
  onSelect,
}: {
  kind: MediaKind;
  item: MediaItem;
  selected: boolean;
  onSelect: (ref: string | null) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(selected ? null : item.ref)}
        className={cn(
          "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-bg-secondary",
          selected && "bg-bg-secondary",
        )}
      >
        <span
          className={cn(
            "shrink-0 overflow-hidden rounded bg-bg-tertiary",
            kind === "videos" ? "h-9 w-16" : "h-9 w-9",
          )}
        >
          {kind === "images" ? (
            <MediaThumbnail url={item.url} hotspot={item.hotspot} />
          ) : kind === "videos" && item.thumbnailUrl ? (
            <img
              src={item.thumbnailUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : kind === "videos" && !item.isHls ? (
            // No stored still: one frame in, as the tile does.
            <video
              src={`${item.url}#t=1`}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm text-fg-primary">
              {item.name}
            </span>
            {item.isNew && <NewBadge />}
          </span>
          <span
            className={cn(
              "block truncate text-xs",
              item.description || kind === "files"
                ? "text-fg-secondary"
                : "italic text-fg-secondary-alt",
            )}
          >
            {kind === "files"
              ? item.folder
              : item.description || "No description"}
          </span>
        </span>
        <span className="shrink-0 text-xs text-fg-secondary">
          {factsOf(item)}
        </span>
      </button>
    </>
  );
}

/** The gap between tiles, in px: `gap-1`. */
const CELL_GAP = 4;
/** A list row's height before it is measured, in px. */
const LIST_ROW_HEIGHT = 48;
/** Under a tile's picture: its padding, the gap and the two lines of text. */
const TILE_CHROME_HEIGHT = 52;

/**
 * Which cell is the selected entry: its place among the entries shown, after
 * `before` cells that come first (the uploads, in the grid). `-1` when it is
 * not shown -- filtered out by a search -- rather than `before - 1`, which
 * scrolled to the last upload.
 */
export function selectedCellIndex(
  selectedRef: string | null,
  shown: readonly { ref: string }[],
  before: number,
): number {
  if (selectedRef === null) return -1;
  const at = shown.findIndex((item) => item.ref === selectedRef);
  return at < 0 ? -1 : before + at;
}

/**
 * The tiles (or the list's rows) on screen, and no others: rows of as many
 * cells as fit, drawn through the virtualizer the record list and the media
 * picker use. The columns are worked out as the grid's own `auto-fill` would
 * (as many `minCellWidthRem` cells as fit, sharing what is left), so a long
 * gallery lays out as a short one does.
 *
 * The tiles are buttons in reading order, so Tab walks them: focusing one
 * scrolls it into view, which mounts the next row before Tab reaches it. A
 * selected entry is scrolled to, so one opened from elsewhere is on screen.
 */
function WindowedCells({
  scroller,
  count,
  minCellWidthRem,
  aspect,
  selectedIndex,
  renderCell,
}: {
  scroller: HTMLElement | null;
  count: number;
  /** `null` for the list: one cell per row. */
  minCellWidthRem: number | null;
  /** A tile's picture's height over its width. */
  aspect: number;
  selectedIndex: number;
  renderCell: (index: number) => ReactNode;
}) {
  const width = useContentWidth(scroller);
  const minCellWidth =
    minCellWidthRem === null ? null : minCellWidthRem * remInPx();
  const columns =
    minCellWidth === null || width === 0
      ? 1
      : Math.max(1, Math.floor((width + CELL_GAP) / (minCellWidth + CELL_GAP)));
  const cellWidth =
    width === 0 ? 0 : (width - CELL_GAP * (columns - 1)) / columns;
  const rowHeight =
    minCellWidth === null
      ? LIST_ROW_HEIGHT
      : Math.round((cellWidth || minCellWidth) * aspect) +
        TILE_CHROME_HEIGHT +
        CELL_GAP;
  const rows = Math.ceil(count / columns);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan: 2,
  });
  // A new width is a new row height for every row.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight, columns]);
  const scrolledTo = useRef<number | null>(null);
  useEffect(() => {
    if (selectedIndex < 0 || width === 0) return;
    if (scrolledTo.current === selectedIndex) return;
    scrolledTo.current = selectedIndex;
    virtualizer.scrollToIndex(Math.floor(selectedIndex / columns), {
      align: "auto",
    });
  }, [virtualizer, selectedIndex, columns, width]);

  return (
    <div
      // The list is a list, as the short one's `<ul>` is.
      role={minCellWidth === null ? "list" : undefined}
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const first = row.index * columns;
        const cells: ReactNode[] = [];
        for (let i = first; i < Math.min(count, first + columns); i++) {
          cells.push(renderCell(i));
        }
        return (
          <div
            key={row.key}
            data-index={row.index}
            role={minCellWidth === null ? "listitem" : undefined}
            ref={virtualizer.measureElement}
            className={cn(
              "absolute left-0 top-0 w-full",
              minCellWidth === null ? "flex flex-col" : "grid gap-1",
            )}
            style={{
              transform: `translateY(${row.start}px)`,
              ...(minCellWidth === null
                ? {}
                : {
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    paddingBottom: CELL_GAP,
                  }),
            }}
          >
            {cells}
          </div>
        );
      })}
    </div>
  );
}

/** The width `ref`'s content has (inside its padding), kept up to date. */
function useContentWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const next = Math.max(
        0,
        element.clientWidth -
          (parseFloat(style.paddingLeft) || 0) -
          (parseFloat(style.paddingRight) || 0),
      );
      setWidth((current) => (current === next ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

/** One `rem` in px: the grid's columns are in rem. */
function remInPx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

function Empty({
  noun,
  searching,
  canUpload,
}: {
  noun: string;
  searching: boolean;
  canUpload: boolean;
}) {
  return (
    <div className="grid h-full min-h-[16rem] place-items-center text-center">
      <div className="flex flex-col items-center gap-2 text-fg-secondary">
        <UploadCloud size={28} className="text-fg-secondary-alt" />
        <p className="text-sm">
          {searching ? `No ${noun} match the search.` : `No ${noun} yet.`}
        </p>
        {!searching && canUpload && (
          <p className="text-xs text-fg-secondary-alt">
            Drop {noun} here, or use Upload.
          </p>
        )}
      </div>
    </div>
  );
}
