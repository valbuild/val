import * as React from "react";
import { Check, ExternalLink, Pencil, Trash2 } from "lucide-react";
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
import { FieldValidationError } from "../FieldValidationError";

interface FilePropertiesModalProps {
  file: GalleryFile | null;
  fileIndex: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFileRename?: (index: number, newFilename: string) => void;
  onAltTextChange?: (index: number, newAltText: string) => void;
  onFileDelete?: (index: number) => void;
  imageMode?: boolean;
  loading?: boolean;
  disabled?: boolean;
  container?: HTMLElement | null;
}

export function FilePropertiesModal({
  file,
  fileIndex,
  open,
  onOpenChange,
  onFileRename,
  onAltTextChange,
  onFileDelete,
  imageMode,
  loading,
  disabled,
  container,
}: FilePropertiesModalProps) {
  if (!file || fileIndex === null) return null;

  const handleFilenameChange = (newFilename: string) => {
    onFileRename?.(fileIndex, newFilename);
  };

  const handleOpenInNewTab = () => {
    window.open(file.url, "_blank", "noopener,noreferrer");
  };

  const isImage = file.metadata.mimeType.startsWith("image/");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" container={container}>
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
              <div
                className={cn("flex flex-col gap-1", {
                  "border-[red] border p-2 rounded":
                    file.fieldSpecificErrors?.alt &&
                    file.fieldSpecificErrors.alt.length > 0,
                })}
              >
                <label className="text-xs font-medium text-fg-secondary">
                  Description
                </label>

                <div>
                  <Input
                    value={file.metadata.alt ?? ""}
                    onChange={(e) => {
                      onAltTextChange?.(fileIndex, e.target.value);
                    }}
                    autoFocus
                    placeholder="Describe this image..."
                  />
                  {file.fieldSpecificErrors?.alt &&
                    file.fieldSpecificErrors.alt.length > 0 && (
                      <ul className="list-none p-0 text-sm">
                        {file.fieldSpecificErrors.alt.map((error, i) => (
                          <li key={i}>
                            <FieldValidationError
                              validationErrors={[{ message: error }]}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
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
          {onFileDelete && fileIndex !== null && (
            <button
              type="button"
              onClick={() => {
                onFileDelete(fileIndex);
                onOpenChange(false);
              }}
              disabled={disabled || loading}
              className="ml-auto inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-bg-error-primary disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
