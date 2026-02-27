import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../designSystem/popover";
import { Button } from "../designSystem/button";
import { cn } from "../designSystem/cn";
import {
  Check,
  ChevronsUpDown,
  ImageIcon,
  FileIcon,
  Search,
} from "lucide-react";
import { prettyModuleName } from "./GalleryUploadTarget";
import { ModuleFilePath } from "@valbuild/core";
import { useFilePatchIds, useSourceAtPath } from "../ValFieldProvider";

export interface GalleryEntry {
  /** The file path key (e.g. "/public/val/images/logo.png") */
  filePath: string;
  /** Metadata for the entry */
  metadata: Record<string, unknown>;
  /** Which module this entry belongs to */
  modulePath: string;
}

export interface MediaPickerProps {
  /** Gallery entries grouped by module: Record<modulePath, Record<filePath, metadata>> */
  moduleEntries: Record<string, Record<string, Record<string, unknown>>>;
  /** Currently selected file ref, if any */
  selectedRef?: string | null;
  /** Called when user selects a gallery entry */
  onSelect: (entry: GalleryEntry) => void;
  /** Whether this is for images (shows thumbnails) or files */
  isImage?: boolean;
  disabled?: boolean;
  /** Portal container for the popover (shadow DOM support) */
  portalContainer?: HTMLElement | null;
  /** Converts a gallery file path to a displayable URL (e.g. for patch-state files) */
  getUrl?: (filePath: string) => string;
}

const ROW_HEIGHT = 48;

/** A flat row for the virtualized list. Can be a heading or an entry. */
type PickerRow =
  | { kind: "heading"; modulePath: string }
  | {
      kind: "entry";
      filePath: string;
      metadata: Record<string, unknown>;
      modulePath: string;
    };

function buildRows(
  moduleEntries: Record<string, Record<string, Record<string, unknown>>>,
  filter: string,
  showHeadings: boolean,
): PickerRow[] {
  const rows: PickerRow[] = [];
  const lowerFilter = filter.toLowerCase();

  for (const modulePath of Object.keys(moduleEntries)) {
    const entries = moduleEntries[modulePath];
    const filtered = Object.keys(entries).filter((fp) => {
      if (!lowerFilter) return true;
      const filename = fp.split("/").pop() || fp;
      const alt =
        typeof entries[fp].alt === "string" ? (entries[fp].alt as string) : "";
      return (
        filename.toLowerCase().includes(lowerFilter) ||
        alt.toLowerCase().includes(lowerFilter)
      );
    });

    if (filtered.length === 0) continue;

    if (showHeadings) {
      rows.push({ kind: "heading", modulePath });
    }

    for (const filePath of filtered) {
      rows.push({
        kind: "entry",
        filePath,
        metadata: entries[filePath] || {},
        modulePath,
      });
    }
  }

  return rows;
}

export function MediaPicker({
  moduleEntries,
  selectedRef,
  onSelect,
  isImage = false,
  disabled = false,
  portalContainer,
  getUrl,
}: MediaPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const modulePaths = Object.keys(moduleEntries);
  const showHeadings = modulePaths.length > 1;

  const rows = React.useMemo(
    () => buildRows(moduleEntries, filter, showHeadings),
    [moduleEntries, filter, showHeadings],
  );

  // Only entry rows are selectable
  const entryIndices = React.useMemo(
    () =>
      rows.reduce<number[]>((acc, row, i) => {
        if (row.kind === "entry") acc.push(i);
        return acc;
      }, []),
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].kind === "heading" ? 28 : ROW_HEIGHT),
    overscan: 10,
  });

  // Reset active index when filter changes
  React.useEffect(() => {
    setActiveIndex(entryIndices.length > 0 ? entryIndices[0] : -1);
  }, [filter, entryIndices]);

  // Focus input and re-measure virtualizer when opening
  React.useEffect(() => {
    if (open) {
      // Delay until after the popover open animation completes so the
      // scroll container has its real dimensions for the virtualizer.
      const t = setTimeout(() => {
        inputRef.current?.focus();
        virtualizer.measure();
      }, 100);
      return () => clearTimeout(t);
    } else {
      setFilter("");
      setActiveIndex(-1);
    }
  }, [open, virtualizer]);

  const selectRow = React.useCallback(
    (index: number) => {
      const row = rows[index];
      if (row?.kind === "entry") {
        onSelect({
          filePath: row.filePath,
          metadata: row.metadata,
          modulePath: row.modulePath,
        });
        setOpen(false);
      }
    },
    [rows, onSelect],
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (entryIndices.length === 0) return;

      const currentPos = entryIndices.indexOf(activeIndex);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next =
          currentPos < entryIndices.length - 1
            ? entryIndices[currentPos + 1]
            : entryIndices[0];
        setActiveIndex(next);
        virtualizer.scrollToIndex(next, { align: "auto" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev =
          currentPos > 0
            ? entryIndices[currentPos - 1]
            : entryIndices[entryIndices.length - 1];
        setActiveIndex(prev);
        virtualizer.scrollToIndex(prev, { align: "auto" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (activeIndex >= 0) {
          selectRow(activeIndex);
        }
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [entryIndices, activeIndex, virtualizer, selectRow],
  );

  if (modulePaths.length === 0) {
    return null;
  }

  const selectedFilename = selectedRef
    ? selectedRef.split("/").pop() || selectedRef
    : null;

  const totalEntries = Object.values(moduleEntries).reduce(
    (sum, entries) => sum + Object.keys(entries).length,
    0,
  );

  const maxHeight = Math.min(totalEntries * ROW_HEIGHT + 60, 320);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          <span className="truncate">
            {selectedFilename ||
              (isImage ? "Select from gallery..." : "Select from files...")}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        container={portalContainer}
      >
        {/* Search input */}
        <div className="flex items-center border-b border-border-primary px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isImage ? "Search images..." : "Search files..."}
            className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          />
        </div>

        {/* Virtualized list */}
        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-fg-secondary">
            {isImage ? "No images found." : "No files found."}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="overflow-auto"
            style={{
              maxHeight: maxHeight,
            }}
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = rows[virtualRow.index];

                if (row.kind === "heading") {
                  return (
                    <div
                      key={`heading-${row.modulePath}`}
                      className="absolute left-0 top-0 w-full px-3 py-1 text-xs font-medium text-fg-secondary"
                      style={{
                        transform: `translateY(${virtualRow.start}px)`,
                        height: `${virtualRow.size}px`,
                      }}
                    >
                      {prettyModuleName(row.modulePath)}
                    </div>
                  );
                }

                const filename = row.filePath.split("/").pop() || row.filePath;
                const isSelected = selectedRef === row.filePath;
                const isActive = virtualRow.index === activeIndex;
                const alt =
                  typeof row.metadata.alt === "string"
                    ? row.metadata.alt
                    : undefined;
                const mimeType =
                  typeof row.metadata.mimeType === "string"
                    ? row.metadata.mimeType
                    : undefined;

                return (
                  <div
                    key={row.filePath}
                    className={cn(
                      "absolute left-0 top-0 flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                      isActive && "bg-bg-primary-hover text-fg-primary",
                    )}
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                      height: `${virtualRow.size}px`,
                    }}
                    onMouseEnter={() => setActiveIndex(virtualRow.index)}
                    onClick={() => selectRow(virtualRow.index)}
                  >
                    <Check
                      className={cn(
                        "h-4 w-4 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {isImage && mimeType?.startsWith("image/") ? (
                      <div className="h-8 w-8 shrink-0 rounded overflow-hidden bg-bg-secondary">
                        <img
                          src={
                            getUrl
                              ? getUrl(row.filePath)
                              : row.filePath.startsWith("/public")
                                ? row.filePath.slice("/public".length)
                                : row.filePath
                          }
                          alt={alt || filename}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                    ) : (
                      <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded bg-bg-secondary">
                        {isImage ? (
                          <ImageIcon className="h-4 w-4 text-fg-secondary" />
                        ) : (
                          <FileIcon className="h-4 w-4 text-fg-secondary" />
                        )}
                      </div>
                    )}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{filename}</span>
                      {alt && (
                        <span className="text-xs text-fg-secondary truncate">
                          {alt}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ModuleMediaPicker({
  modulePath,
  ...rest
}: Omit<MediaPickerProps, "moduleEntries"> & { modulePath: ModuleFilePath }) {
  const source = useSourceAtPath(modulePath);
  const filePatchIds = useFilePatchIds();

  const getUrl = React.useCallback(
    (filePath: string): string => {
      const patchId = filePatchIds.get(filePath);
      if (patchId) {
        return filePath.startsWith("/public")
          ? `/api/val/files${filePath}?patch_id=${patchId}`
          : `${filePath}?patch_id=${patchId}`;
      }
      return filePath.startsWith("/public")
        ? filePath.slice("/public".length)
        : filePath;
    },
    [filePatchIds],
  );

  if (source.status !== "success") {
    return null;
  }
  const moduleEntries = {
    [modulePath]: source.data as Record<string, Record<string, unknown>>,
  };
  return (
    <MediaPicker moduleEntries={moduleEntries} getUrl={getUrl} {...rest} />
  );
}
