import * as React from "react";
import { cn } from "../designSystem/cn";
import { Input } from "../designSystem/input";
import type { GalleryFile } from "./types";

interface FilePropertiesProps {
  file: GalleryFile;
  fileIndex: number;
  onFileRename?: (index: number, newFilename: string) => void;
  className?: string;
}

export function FileProperties({
  file,
  fileIndex,
  onFileRename,
  className,
}: FilePropertiesProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedFilename, setEditedFilename] = React.useState(file.filename);

  React.useEffect(() => {
    setEditedFilename(file.filename);
    setIsEditing(false);
  }, [file.filename]);

  const handleSave = () => {
    if (editedFilename.trim() && editedFilename !== file.filename) {
      onFileRename?.(fileIndex, editedFilename.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setEditedFilename(file.filename);
      setIsEditing(false);
    }
  };

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
          {isEditing ? (
            <Input
              value={editedFilename}
              onChange={(e) => setEditedFilename(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              autoFocus
              className="h-8 text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => onFileRename && setIsEditing(true)}
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
      </div>
    </div>
  );
}
