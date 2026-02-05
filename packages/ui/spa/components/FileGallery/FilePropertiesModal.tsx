import * as React from "react";
import { Check, ExternalLink, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../designSystem/dialog";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";
import { FilePreview } from "./FilePreview";
import { FilenameInput } from "./FilenameInput";
import type { GalleryFile } from "./types";

interface FilePropertiesModalProps {
  file: GalleryFile | null;
  fileIndex: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileRename?: (index: number, newFilename: string) => void;
  onAltTextChange?: (index: number, newAltText: string) => void;
  imageMode?: boolean;
  loading?: boolean;
  disabled?: boolean;
}

export function FilePropertiesModal({
  file,
  fileIndex,
  open,
  onOpenChange,
  onFileRename,
  onAltTextChange,
  imageMode,
  loading,
  disabled,
}: FilePropertiesModalProps) {
  const [isEditingAlt, setIsEditingAlt] = React.useState(false);
  const [editedAlt, setEditedAlt] = React.useState("");

  React.useEffect(() => {
    if (file) {
      setEditedAlt(file.metadata.alt ?? "");
      setIsEditingAlt(false);
    }
  }, [file]);

  if (!file || fileIndex === null) return null;

  const handleFilenameChange = (newFilename: string) => {
    onFileRename?.(fileIndex, newFilename);
  };

  const handleSaveAlt = () => {
    if (editedAlt !== (file.metadata.alt ?? "")) {
      onAltTextChange?.(fileIndex, editedAlt);
    }
    setIsEditingAlt(false);
  };

  const handleAltKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveAlt();
    } else if (e.key === "Escape") {
      setEditedAlt(file.metadata.alt ?? "");
      setIsEditingAlt(false);
    }
  };

  const handleOpenInNewTab = () => {
    window.open(file.url, "_blank", "noopener,noreferrer");
  };

  const isImage = file.metadata.mimeType.startsWith("image/");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>File Properties</DialogTitle>
        </DialogHeader>

        <div className="flex gap-6">
          {/* Preview */}
          <div className="shrink-0">
            <div className="h-32 w-32 overflow-hidden rounded-lg border border-border-secondary bg-bg-secondary">
              <FilePreview file={file} />
            </div>
          </div>

          {/* Properties */}
          <div className="flex-1 space-y-4">
            {/* Filename */}
            {onFileRename && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-secondary">
                  Filename
                </label>
                <FilenameInput
                  filename={file.filename}
                  onSave={handleFilenameChange}
                  disabled={disabled || loading}
                />
              </div>
            )}

            {/* Alt Text (only for images in imageMode) */}
            {imageMode && isImage && onAltTextChange && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-secondary">
                  Alt Text
                </label>
                {isEditingAlt ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={editedAlt}
                      onChange={(e) => setEditedAlt(e.target.value)}
                      onKeyDown={handleAltKeyDown}
                      autoFocus
                      placeholder="Describe this image..."
                      className="h-8 flex-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={handleSaveAlt}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-secondary transition-colors hover:bg-bg-secondary hover:text-fg-primary"
                      title="Save"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <span
                      className={cn(
                        "flex-1 truncate rounded px-2 py-1.5 text-sm",
                        file.metadata.alt
                          ? "text-fg-primary"
                          : "text-fg-secondary italic",
                      )}
                      title={file.metadata.alt || undefined}
                    >
                      {file.metadata.alt || "No alt text"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsEditingAlt(true)}
                      disabled={disabled || loading}
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
                        disabled || loading
                          ? "cursor-not-allowed text-fg-disabled"
                          : "text-fg-secondary hover:bg-bg-secondary hover:text-fg-primary",
                      )}
                      title={disabled ? "Editing disabled" : "Edit alt text"}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-fg-secondary">
                  Folder
                </span>
                <span
                  className="truncate text-sm text-fg-primary"
                  title={file.folder}
                >
                  {file.folder}
                </span>
              </div>

              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-fg-secondary">
                  Type
                </span>
                <span className="text-sm text-fg-primary">
                  {file.metadata.mimeType}
                </span>
              </div>

              {(file.metadata.width > 0 || file.metadata.height > 0) && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-fg-secondary">
                    Dimensions
                  </span>
                  <span className="text-sm text-fg-primary">
                    {file.metadata.width} × {file.metadata.height} px
                  </span>
                </div>
              )}
            </div>

            {/* Validation errors */}
            {file.validationErrors && file.validationErrors.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-destructive">
                  Validation Errors
                </span>
                <ul className="list-inside list-disc text-sm text-destructive">
                  {file.validationErrors.map((error, i) => (
                    <li key={i}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2 border-t border-border-secondary pt-4">
          <button
            type="button"
            onClick={handleOpenInNewTab}
            className="inline-flex items-center gap-2 rounded-md bg-bg-secondary px-3 py-2 text-sm font-medium text-fg-primary transition-colors hover:bg-bg-tertiary"
          >
            <ExternalLink className="h-4 w-4" />
            Open in New Tab
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
