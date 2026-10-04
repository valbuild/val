import { useMemo, useRef, useState } from "react";
import { Grid, List, Loader2, Search, Upload, UploadCloud } from "lucide-react";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";
import { MediaThumbnail } from "../MediaThumbnail";
import { MediaInspector } from "./MediaInspector";
import { MediaTile, UploadTile } from "./MediaTile";
import { factsOf } from "./format";
import type { MediaGalleryProps, MediaItem, MediaKind } from "./types";

const NOUN: Record<MediaKind, { one: string; many: string }> = {
  images: { one: "image", many: "images" },
  videos: { one: "video", many: "videos" },
  files: { one: "file", many: "files" },
};

/**
 * A gallery — `s.imageset()`, `s.videoset()`, `s.fileset()` — as one layout:
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
}: MediaGalleryProps) {
  const [view, setView] = useState<"grid" | "list">(defaultView);
  const [query, setQuery] = useState("");
  const noun = NOUN[kind];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? items.filter(
          (item) =>
            item.name.toLowerCase().includes(q) ||
            (item.description ?? "").toLowerCase().includes(q),
        )
      : items;
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

  return (
    <div className="relative flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-border-secondary bg-bg-primary">
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
            {uploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            Upload
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-2">
          {shown.length === 0 && uploads.length === 0 ? (
            <Empty
              noun={noun.many}
              searching={query.trim() !== ""}
              canUpload={!!onUploadClick && !readonly}
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
          <div className="absolute inset-0 z-10 bg-bg-primary md:static md:z-auto md:w-80 md:shrink-0 md:border-l md:border-border-secondary">
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
      {items.map((item) => {
        const selected = item.ref === selectedRef;
        return (
          <li key={item.ref}>
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
                <span className="block truncate text-sm text-fg-primary">
                  {item.name}
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
          </li>
        );
      })}
    </ul>
  );
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
