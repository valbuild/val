import { cn } from "../designSystem/cn";
import { FilePreview } from "./FilePreview";
import type { GalleryFile } from "./types";

interface FileGalleryItemProps {
  file: GalleryFile;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

export function FileGalleryItem({
  file,
  isSelected,
  onClick,
  onDoubleClick,
}: FileGalleryItemProps) {
  // Calculate aspect ratio for masonry layout
  const hasValidDimensions =
    file.metadata.width > 0 && file.metadata.height > 0;
  const aspectRatio = hasValidDimensions
    ? file.metadata.width / file.metadata.height
    : 1;

  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group mb-2 flex w-full break-inside-avoid flex-col overflow-hidden rounded border bg-bg-primary transition-all",
        "hover:border-border-primary hover:shadow-md",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        isSelected
          ? "border-accent ring-2 ring-accent"
          : "border-border-secondary",
      )}
    >
      <div
        className="relative w-full overflow-hidden bg-bg-secondary"
        style={{
          aspectRatio: aspectRatio,
        }}
      >
        <FilePreview file={file} />
      </div>
      <div className="p-1.5">
        <p
          className="truncate text-xs font-medium text-fg-primary"
          title={file.filename}
        >
          {file.filename}
        </p>
      </div>
    </button>
  );
}
