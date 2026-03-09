import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "../designSystem/cn";
import { FilePreview } from "./FilePreview";
import type { GalleryFile, SortDirection, SortField } from "./types";

interface FileGalleryListViewProps {
  files: GalleryFile[];
  onItemClick: (index: number) => void;
  sortField: SortField;
  sortDirection: SortDirection;
  onSort: (field: SortField) => void;
}

const ROW_HEIGHT = 50;

function SortIcon({
  field,
  currentField,
  direction,
}: {
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
}) {
  if (field !== currentField) {
    return <ArrowUpDown className="h-3 w-3 opacity-50" />;
  }
  return direction === "asc" ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
}

function formatMimeType(mimeType: string): string {
  // Show a simplified version, e.g., "JPEG" instead of "image/jpeg"
  const [, subtype] = mimeType.split("/");
  return subtype?.toUpperCase() ?? mimeType;
}

export function FileGalleryListView({
  files,
  onItemClick,
  sortField,
  sortDirection,
  onSort,
}: FileGalleryListViewProps) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const showAltColumn = files.some((f) => f.metadata.alt !== undefined);
  // Without alt: icon(56px) | name(1fr) | type(96px)
  // With alt:    icon(56px) | description(1fr) | name(192px) | type(96px)
  const gridCols = showAltColumn
    ? "grid-cols-[56px_1fr_192px_96px]"
    : "grid-cols-[56px_1fr_96px]";

  return (
    <div className="overflow-hidden rounded-lg">
      {/* Header */}
      <div className="rounded-t-lg border border-border-secondary bg-bg-secondary text-left text-xs font-medium text-fg-secondary">
        <div className={cn("grid", gridCols)}>
          <div className="px-3 py-2"></div>
          {showAltColumn ? (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => onSort("description")}
                className="flex items-center gap-1 hover:text-fg-primary"
              >
                Description
                <SortIcon
                  field="description"
                  currentField={sortField}
                  direction={sortDirection}
                />
              </button>
            </div>
          ) : (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => onSort("name")}
                className="flex items-center gap-1 hover:text-fg-primary"
              >
                Name
                <SortIcon
                  field="name"
                  currentField={sortField}
                  direction={sortDirection}
                />
              </button>
            </div>
          )}
          {showAltColumn && (
            <div className="px-3 py-2">
              <button
                type="button"
                onClick={() => onSort("name")}
                className="flex items-center gap-1 hover:text-fg-primary"
              >
                Name
                <SortIcon
                  field="name"
                  currentField={sortField}
                  direction={sortDirection}
                />
              </button>
            </div>
          )}
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={() => onSort("type")}
              className="flex items-center gap-1 hover:text-fg-primary"
            >
              Type
              <SortIcon
                field="type"
                currentField={sortField}
                direction={sortDirection}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Virtualized body */}
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{
          contain: "strict",
          height: Math.min(files.length * ROW_HEIGHT, 600),
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const file = files[virtualRow.index];
            const hasErrors =
              (file.validationErrors && file.validationErrors.length > 0) ||
              (file.fieldSpecificErrors &&
                Object.values(file.fieldSpecificErrors).some(
                  (errs) => errs && errs.length > 0,
                ));

            const isFirstRow = virtualRow.index === 0;
            const isLastRow = virtualRow.index === files.length - 1;
            const showTopErrorBorder =
              hasErrors &&
              (virtualRow.index === 0 ||
                !(
                  files[virtualRow.index - 1].validationErrors &&
                  files[virtualRow.index - 1].validationErrors!.length > 0
                ));
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                onClick={() => onItemClick(virtualRow.index)}
                className={cn(
                  "absolute left-0 top-0 grid w-full cursor-pointer border border-b-0 transition-colors",
                  isFirstRow && "border-t-0",
                  isLastRow && "border-b",
                  gridCols,
                  "border-border-secondary hover:bg-bg-secondary",
                  hasErrors &&
                    "border border-bg-error-primary hover:border-bg-error-primary-hover",
                  !showTopErrorBorder && hasErrors && "border-t-0",
                  isLastRow && "rounded-b-lg",
                )}
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                title={
                  hasErrors ? file.validationErrors?.join(", ") : undefined
                }
              >
                <div className="flex items-center px-3 py-2">
                  <div className="h-8 w-8 overflow-hidden rounded bg-bg-secondary">
                    <FilePreview file={file} />
                  </div>
                </div>
                {showAltColumn ? (
                  <>
                    <div className="flex items-center overflow-hidden px-3 py-2">
                      <span className="truncate text-sm font-medium text-fg-primary">
                        {file.metadata.alt ?? ""}
                      </span>
                    </div>
                    <div className="flex items-center overflow-hidden px-3 py-2">
                      <span className="truncate text-sm text-fg-secondary">
                        {file.filename}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center overflow-hidden px-3 py-2">
                    <span className="truncate text-sm font-medium text-fg-primary">
                      {file.filename}
                    </span>
                  </div>
                )}
                <div className="flex items-center px-3 py-2">
                  <span className="text-sm text-fg-secondary">
                    {formatMimeType(file.metadata.mimeType)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
