import { cn } from "../designSystem/cn";
import { FilePreview } from "./FilePreview";
import type { GalleryFile, ViewMode } from "./types";

interface FileGalleryItemProps {
  file: GalleryFile;
  onClick: () => void;
  viewMode: ViewMode;
  imageMode?: boolean;
}

export function FileGalleryItem({
  file,
  onClick,
  viewMode,
  imageMode,
}: FileGalleryItemProps) {
  // Calculate aspect ratio for masonry layout
  const hasValidDimensions =
    file.metadata.width > 0 && file.metadata.height > 0;
  const aspectRatio = hasValidDimensions
    ? file.metadata.width / file.metadata.height
    : 1;

  const hasErrors =
    (file.validationErrors && file.validationErrors.length > 0) ||
    (file.fieldSpecificErrors &&
      Object.values(file.fieldSpecificErrors).some(
        (errs) => errs && errs.length > 0,
      ));

  const buttonContent = (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col overflow-hidden rounded border bg-bg-primary transition-all",
        "hover:shadow-md",
        "focus:outline-none focus:ring-2 focus:ring-offset-2",
        hasErrors
          ? "border-bg-error-primary ring-bg-error-primary/50 hover:border-bg-error-primary-hover focus:ring-bg-error-primary"
          : "border-border-secondary hover:border-border-primary focus:ring-ring",
      )}
      title={hasErrors ? file.validationErrors?.join(", ") : undefined}
    >
      <div
        className={cn("relative w-full overflow-hidden bg-bg-secondary")}
        style={{
          aspectRatio: viewMode === "masonry" ? aspectRatio : 1,
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
        {imageMode &&
          file.metadata.mimeType.startsWith("image/") &&
          file.metadata.alt && (
            <p
              className="truncate text-xs text-fg-secondary"
              title={file.metadata.alt}
            >
              {file.metadata.alt}
            </p>
          )}
      </div>
    </button>
  );

  if (viewMode === "masonry") {
    return <div className="mb-2 break-inside-avoid">{buttonContent}</div>;
  }

  return buttonContent;
}
