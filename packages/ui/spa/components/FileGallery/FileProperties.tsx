import * as React from "react";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";
import type { GalleryFile } from "./types";

interface FilePropertiesProps {
  file: GalleryFile;
  fileIndex: number;
  onFileRename?: (index: number, newFilename: string) => void;
  onAltTextChange?: (index: number, newAltText: string) => void;
  imageMode?: boolean;
  className?: string;
}

export function FileProperties({
  file,
  fileIndex,
  onFileRename,
  onAltTextChange,
  imageMode,
  className,
}: FilePropertiesProps) {
  const [isEditingFilename, setIsEditingFilename] = React.useState(false);
  const [editedFilename, setEditedFilename] = React.useState(file.filename);
  const [isEditingAlt, setIsEditingAlt] = React.useState(false);
  const [editedAlt, setEditedAlt] = React.useState(file.metadata.alt ?? "");

  React.useEffect(() => {
    setEditedFilename(file.filename);
    setIsEditingFilename(false);
    setEditedAlt(file.metadata.alt ?? "");
    setIsEditingAlt(false);
  }, [file.filename, file.metadata.alt]);

  const handleSaveFilename = () => {
    if (editedFilename.trim() && editedFilename !== file.filename) {
      onFileRename?.(fileIndex, editedFilename.trim());
    }
    setIsEditingFilename(false);
  };

  const handleSaveAlt = () => {
    if (editedAlt !== (file.metadata.alt ?? "")) {
      onAltTextChange?.(fileIndex, editedAlt);
    }
    setIsEditingAlt(false);
  };

  const handleFilenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveFilename();
    } else if (e.key === "Escape") {
      setEditedFilename(file.filename);
      setIsEditingFilename(false);
    }
  };

  const handleAltKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSaveAlt();
    } else if (e.key === "Escape") {
      setEditedAlt(file.metadata.alt ?? "");
      setIsEditingAlt(false);
    }
  };

  const isImage = file.metadata.mimeType.startsWith("image/");

  // Format date for display
  const formattedDate = file.createdAt
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(file.createdAt)
    : null;

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border-secondary bg-bg-primary p-4",
        className,
      )}
    >
      <h3 className="text-sm font-semibold text-fg-primary">Properties</h3>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-secondary">
            Filename
          </label>
          {isEditingFilename ? (
            <Input
              value={editedFilename}
              onChange={(e) => setEditedFilename(e.target.value)}
              onBlur={handleSaveFilename}
              onKeyDown={handleFilenameKeyDown}
              autoFocus
              className="h-8 text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => onFileRename && setIsEditingFilename(true)}
              className={cn(
                "truncate rounded px-2 py-1.5 text-left text-sm text-fg-primary",
                onFileRename
                  ? "cursor-pointer hover:bg-bg-secondary"
                  : "cursor-default",
              )}
              title={onFileRename ? "Click to rename" : undefined}
            >
              {file.filename}
            </button>
          )}
        </div>

        {imageMode && isImage && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-fg-secondary">
              Alt Text
            </label>
            {isEditingAlt ? (
              <Input
                value={editedAlt}
                onChange={(e) => setEditedAlt(e.target.value)}
                onBlur={handleSaveAlt}
                onKeyDown={handleAltKeyDown}
                autoFocus
                placeholder="Describe this image..."
                className="h-8 text-sm"
              />
            ) : (
              <button
                type="button"
                onClick={() => onAltTextChange && setIsEditingAlt(true)}
                className={cn(
                  "truncate rounded px-2 py-1.5 text-left text-sm",
                  file.metadata.alt
                    ? "text-fg-primary"
                    : "text-fg-secondary italic",
                  onAltTextChange
                    ? "cursor-pointer hover:bg-bg-secondary"
                    : "cursor-default",
                )}
                title={onAltTextChange ? "Click to edit alt text" : undefined}
              >
                {file.metadata.alt || "No alt text"}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-secondary">
            Folder
          </label>
          <p className="truncate text-sm text-fg-primary" title={file.folder}>
            {file.folder}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-secondary">
            MIME Type
          </label>
          <p className="text-sm text-fg-primary">{file.metadata.mimeType}</p>
        </div>

        {(file.metadata.width > 0 || file.metadata.height > 0) && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-fg-secondary">
              Dimensions
            </label>
            <p className="text-sm text-fg-primary">
              {file.metadata.width} × {file.metadata.height} px
            </p>
          </div>
        )}

        {formattedDate && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-fg-secondary">
              Created
            </label>
            <p className="text-sm text-fg-primary">{formattedDate}</p>
          </div>
        )}
      </div>
    </div>
  );
}
