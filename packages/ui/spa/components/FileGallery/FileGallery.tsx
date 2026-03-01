import * as React from "react";
import {
  FolderOpen,
  Grid,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";
import { Skeleton } from "../designSystem/skeleton";
import { FileGalleryItem } from "./FileGalleryItem";
import { FileGalleryListView } from "./FileGalleryListView";
import { FilePropertiesModal } from "./FilePropertiesModal";
import { useValPortal } from "../ValPortalProvider";
import type {
  FileGalleryProps,
  SortDirection,
  SortField,
  ViewMode,
} from "./types";

export function FileGallery({
  files,
  onFileRename,
  onAltTextChange,
  onFileDelete,
  className,
  defaultViewMode = "list",
  showSearch = true,
  imageMode = false,
  loading = false,
  disabled = false,
  onUploadClick,
  uploading = false,
}: FileGalleryProps) {
  const portalContainer = useValPortal();
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const [isPropertiesOpen, setIsPropertiesOpen] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<ViewMode>(defaultViewMode);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [sortField, setSortField] = React.useState<SortField>("name");
  const [sortDirection, setSortDirection] =
    React.useState<SortDirection>("asc");

  // Filter files based on search query
  const filteredFiles = React.useMemo(() => {
    let result = files;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (file) =>
          file.filename.toLowerCase().includes(query) ||
          (file.metadata.alt ?? "").toLowerCase().includes(query),
      );
    }

    // Apply sorting for list view
    if (viewMode === "list") {
      result = [...result].sort((a, b) => {
        let comparison = 0;

        switch (sortField) {
          case "name":
            comparison = a.filename.localeCompare(b.filename);
            break;
          case "description":
            comparison = (a.metadata.alt ?? "").localeCompare(
              b.metadata.alt ?? "",
            );
            break;
          case "type":
            comparison = a.metadata.mimeType.localeCompare(b.metadata.mimeType);
            break;
        }

        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return result;
  }, [files, searchQuery, viewMode, sortField, sortDirection]);

  // Map filtered index back to original index for selection
  const getOriginalIndex = React.useCallback(
    (filteredIndex: number) => {
      const filteredFile = filteredFiles[filteredIndex];
      return files.findIndex(
        (f) =>
          f.folder === filteredFile.folder &&
          f.filename === filteredFile.filename,
      );
    },
    [files, filteredFiles],
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const selectedFile =
    selectedIndex !== null ? (files[selectedIndex] ?? null) : null;

  const handleItemClick = (filteredIndex: number) => {
    const originalIndex = getOriginalIndex(filteredIndex);
    setSelectedIndex(originalIndex);
    setIsPropertiesOpen(true);
  };

  // Empty state content - shown inside the main layout to preserve toolbar
  const emptyContent = (
    <div className="flex flex-1 items-center justify-center py-12">
      <div className="flex max-w-md flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border-secondary bg-bg-secondary p-12">
        <FolderOpen className="h-16 w-16 text-fg-secondary" />
        <div className="text-center">
          <p className="text-lg font-medium text-fg-primary">No files</p>
          <p className="text-sm text-fg-secondary">
            There are no files to display
          </p>
        </div>
      </div>
    </div>
  );

  // Loading skeleton content
  const loadingContent = (
    <div className="columns-3 gap-2 sm:columns-4 md:columns-5 lg:columns-6 xl:columns-8">
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} className="mb-2 break-inside-avoid">
          <div className="flex w-full flex-col overflow-hidden rounded border border-border-secondary bg-bg-primary">
            <Skeleton
              className="w-full"
              style={{ aspectRatio: 1 + Math.random() * 0.5 }}
            />
            <div className="p-1.5">
              <Skeleton className="h-4 w-3/4" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        {showSearch && (
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-secondary" />
            <Input
              type="text"
              placeholder="Filter"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8"
            />
          </div>
        )}
        <div className="flex items-center gap-1 ml-auto">
          {onUploadClick && (
            <button
              type="button"
              onClick={onUploadClick}
              disabled={uploading}
              className="rounded p-1.5 transition-colors text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary disabled:opacity-50"
              title="Upload file"
            >
              {uploading ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <Plus className="size-5" />
              )}
            </button>
          )}
          {/* TODO: fix overflow in Masonry */}
          {/* <button
            type="button"
            onClick={() => setViewMode("masonry")}
            className={cn(
              "rounded p-1.5 transition-colors",
              viewMode === "masonry"
                ? "bg-bg-secondary text-fg-primary"
                : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
            )}
            title="Masonry view"
          >
            <LayoutGrid className="size-5" />
          </button> */}
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={cn(
              "rounded p-1.5 transition-colors",
              viewMode === "grid"
                ? "bg-bg-secondary text-fg-primary"
                : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
            )}
            title="Grid view"
          >
            <Grid className="size-5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={cn(
              "rounded p-1.5 transition-colors",
              viewMode === "list"
                ? "bg-bg-secondary text-fg-primary"
                : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
            )}
            title="List view"
          >
            <List className="size-5" />
          </button>
        </div>
      </div>

      {/* Gallery content */}
      <div>
        {loading ? (
          loadingContent
        ) : files.length === 0 ? (
          emptyContent
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <Search className="h-8 w-8 text-fg-secondary" />
            <p className="text-sm text-fg-secondary">
              No files match "{searchQuery}"
            </p>
          </div>
        ) : viewMode === "masonry" ? (
          <div className="columns-3 gap-2 sm:columns-4 md:columns-5 lg:columns-6 xl:columns-8">
            {filteredFiles.map((file, index) => (
              <FileGalleryItem
                key={`${file.folder}/${file.filename}`}
                file={file}
                onClick={() => handleItemClick(index)}
                viewMode={viewMode}
                imageMode={imageMode}
              />
            ))}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
            {filteredFiles.map((file, index) => (
              <FileGalleryItem
                key={`${file.folder}/${file.filename}`}
                file={file}
                onClick={() => handleItemClick(index)}
                viewMode={viewMode}
                imageMode={imageMode}
              />
            ))}
          </div>
        ) : (
          <FileGalleryListView
            files={filteredFiles}
            onItemClick={handleItemClick}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
          />
        )}
      </div>

      <FilePropertiesModal
        file={selectedFile}
        fileIndex={selectedIndex}
        open={isPropertiesOpen}
        onOpenChange={setIsPropertiesOpen}
        onFileRename={onFileRename}
        onAltTextChange={onAltTextChange}
        onFileDelete={onFileDelete}
        imageMode={imageMode}
        loading={loading}
        disabled={disabled}
        container={portalContainer}
      />
    </div>
  );
}
